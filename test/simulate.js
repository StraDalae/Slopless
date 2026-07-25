// test/simulate.js
//
// Walks through the full pipeline end-to-end using realistic scenarios, so
// you can see the rules play out without building any UI. Run with:
//   node test/simulate.js
//
// Deletes and recreates data.sqlite each run so scenarios are repeatable.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.sqlite');
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = require('../src/db');
const { uploadContent } = require('../src/upload');
const { fileReport } = require('../src/reports');
const { fileAppeal, resolveAppeal, autoConfirmExpiredStrikes, confirmedStrikeCount } = require('../src/appeals');
const { canPost, getRestriction } = require('../src/restrictions');
const { getReviewPriority } = require('../src/badges');

const FIXTURES = path.join(__dirname, 'fixtures');

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

function createUser(username, followers = 0) {
  const result = db
    .prepare('INSERT INTO users (username, followers) VALUES (?, ?)')
    .run(username, followers);
  return result.lastInsertRowid;
}

async function main() {
  // --- Set up a cast of users ---
  const alice = createUser('alice_films_real_life', 500);     // will post genuine camera content
  const bob = createUser('bob_ai_slop', 200);                  // will post AI content, get caught
  const carol = createUser('carol_big_creator', 50000);        // high-follower, tests fast-track review
  const reporters = ['r1', 'r2', 'r3', 'r4'].map((name) => createUser(name));

  section('SCENARIO 1: Genuine camera footage -> HUMAN_VERIFIED badge');
  const aliceUpload = await uploadContent(alice, path.join(FIXTURES, 'camera_verified.jpg'), 'video');
  console.log(aliceUpload);
  console.log('-> Camera make/model present, no AI signature, clean strike record: earns the strongest badge.');

  section('SCENARIO 2: AI tool signature detected in metadata -> no badge, flagged content');
  const bobUpload = await uploadContent(bob, path.join(FIXTURES, 'ai_generated.jpg'), 'video');
  console.log(bobUpload);
  console.log('-> Metadata itself names a known AI tool. No badge. In a real system this would likely');
  console.log('   also auto-route to review rather than going straight LIVE -- left as an exercise, since');
  console.log('   real AI content usually WON\'T have this metadata (easy to strip) -- see Scenario 4.');

  section('SCENARIO 3: Edited but no camera tag -> UNVERIFIED (not accused, not vouched for)');
  const edited = await uploadContent(alice, path.join(FIXTURES, 'edited_unknown.jpg'), 'video');
  console.log(edited);

  section('SCENARIO 4: Metadata stripped entirely -> NO_METADATA, relies on community reporting');
  const stripped = await uploadContent(bob, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  console.log(stripped);
  console.log('-> This is the realistic AI-slop case: strip the metadata, pass the naive check.');
  console.log('   This is exactly why metadata alone can\'t be the whole system -- community reporting');
  console.log('   is what catches this in practice.');

  section('SCENARIO 5: Community reports pile up on the stripped-metadata post -> auto-flag');
  console.log(`Content ID under fire: ${stripped.contentId} (posted by bob_ai_slop)`);
  let lastReportResult;
  for (const reporterId of reporters) {
    lastReportResult = fileReport(stripped.contentId, reporterId);
    console.log(` report from user ${reporterId}:`, lastReportResult);
  }
  console.log('-> Reports are weighted by reporter_trust (all reporters start at 1.0), so it took');
  console.log('   3 reports to cross the 3.0 threshold. Content moves to UNDER_REVIEW, a PENDING');
  console.log('   strike opens -- it is NOT deleted yet.');

  section('SCENARIO 6a: Creator appeals and WINS (false positive)');
  // Re-flag a fresh piece of content to demonstrate the "win" path separately
  const winCase = await uploadContent(alice, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  for (const reporterId of reporters.slice(0, 3)) fileReport(winCase.contentId, reporterId);
  const strikeForWin = db
    .prepare('SELECT * FROM strikes WHERE content_id = ? ORDER BY id DESC LIMIT 1')
    .get(winCase.contentId);
  console.log('Strike opened:', strikeForWin);
  const appealWin = fileAppeal(strikeForWin.id, 'This is my own unedited phone footage, camera app strips EXIF on export.');
  console.log('Appeal filed:', appealWin);
  const resolvedWin = resolveAppeal(appealWin.appealId, 'APPROVED');
  console.log('Appeal resolved:', resolvedWin);
  console.log(`-> Confirmed strikes for alice after winning appeal: ${confirmedStrikeCount(alice)} (still 0 -- appeal won, no penalty)`);

  section('SCENARIO 6b: Creator appeals and LOSES (report was right)');
  const strikeForBob = db
    .prepare('SELECT * FROM strikes WHERE content_id = ? ORDER BY id DESC LIMIT 1')
    .get(stripped.contentId);
  const appealLoss = fileAppeal(strikeForBob.id, 'This is real, I swear.');
  console.log('Appeal filed:', appealLoss);
  const resolvedLoss = resolveAppeal(appealLoss.appealId, 'DENIED');
  console.log('Appeal resolved:', resolvedLoss);
  console.log(`-> Confirmed strikes for bob now: ${confirmedStrikeCount(bob)}`);

  section('SCENARIO 7: Repeated offenses escalate to a posting restriction');
  // Give bob more confirmed strikes by repeating the report+deny cycle.
  // Note: reporter_trust shifts after every resolved appeal (see reports.js),
  // so we use the whole reporter pool each round rather than a fixed 3 --
  // in a live system you'd have far more than 4 possible reporters anyway.
  for (let i = 0; i < 3; i++) {
    const upload = await uploadContent(bob, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
    if (!upload.success) {
      console.log(`Upload attempt ${i + 1} blocked:`, upload);
      continue;
    }
    let flaggedResult;
    for (const reporterId of reporters) {
      const r = fileReport(upload.contentId, reporterId);
      if (r.flagged) flaggedResult = r;
    }
    if (!flaggedResult) {
      console.log(`Round ${i + 1}: reports didn't cross the flag threshold this time ` +
        `(reporter trust has drifted down from earlier false accusations) -- skipping.`);
      continue;
    }
    const strike = db
      .prepare('SELECT * FROM strikes WHERE content_id = ? ORDER BY id DESC LIMIT 1')
      .get(upload.contentId);
    const appeal = fileAppeal(strike.id, 'not appealing much, just checking');
    resolveAppeal(appeal.appealId, 'DENIED');
    console.log(`Round ${i + 1}: bob's confirmed strikes = ${confirmedStrikeCount(bob)}, ` +
      `posting status = ${JSON.stringify(canPost(bob))}`);
  }

  section('SCENARIO 8: Duplicate report + rate limiting guardrails');
  const dupe = fileReport(stripped.contentId, reporters[0]);
  console.log('Same user reporting the same content twice:', dupe);

  section('SCENARIO 9: High-follower account -> fast-track review, NOT auto-badge');
  const carolUpload = await uploadContent(carol, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  console.log('Upload result:', carolUpload);
  console.log('Review priority for carol (50k followers):', getReviewPriority(carol));
  console.log('-> Note: badge is still UNVERIFIED despite the huge follower count -- follower count only');
  console.log('   affects how fast a human reviewer should look at it, never whether it auto-passes.');

  section('SCENARIO 10: Auto-confirm strikes where the appeal window expired unused');
  console.log('(In this simulation nothing has actually aged 48 hours, so this will be a no-op --');
  console.log(' wire this function into a real cron job / scheduled task in production.)');
  const autoConfirmed = autoConfirmExpiredStrikes();
  console.log('Auto-confirmed strike IDs:', autoConfirmed);

  section('DONE');
  console.log('Explore data.sqlite directly with any SQLite browser to see full table state.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
