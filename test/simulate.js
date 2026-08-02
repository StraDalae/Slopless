// test/simulate.js
//
// Walks through the full pipeline end-to-end using realistic scenarios, so
// you can see the rules play out without building any UI. Run with:
//   POSTGRES_URL=postgres://... node test/simulate.js
//
// Truncates all tables at the start so scenarios are repeatable against
// whatever Postgres database POSTGRES_URL points to. Point it at a scratch/
// test database, not anything with real data in it.

const path = require('path');
const db = require('../src/db');
const { uploadContent } = require('../src/upload');
const { fileReport } = require('../src/reports');
const { fileAppeal, resolveAppeal, autoConfirmExpiredStrikes, confirmedStrikeCount } = require('../src/appeals');
const { canPost } = require('../src/restrictions');
const { getReviewPriority } = require('../src/badges');

const FIXTURES = path.join(__dirname, 'fixtures');

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function resetDatabase() {
  await db.ensureSchema();
  await db.query('TRUNCATE appeals, strikes, reports, content, users RESTART IDENTITY CASCADE');
}

async function createUser(username, followers = 0) {
  const row = await db.get('INSERT INTO users (username, followers) VALUES ($1, $2) RETURNING id', [
    username,
    followers,
  ]);
  return row.id;
}

async function main() {
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) {
    console.error('Set POSTGRES_URL (or DATABASE_URL) before running this. Example:');
    console.error('  POSTGRES_URL=postgres://postgres:postgres@localhost:5432/slopless_test node test/simulate.js');
    process.exit(1);
  }

  await resetDatabase();

  // --- Set up a cast of users ---
  const alice = await createUser('alice_films_real_life', 500);
  const bob = await createUser('bob_ai_slop', 200);
  const carol = await createUser('carol_big_creator', 50000);
  const reporters = [];
  for (const name of ['r1', 'r2', 'r3', 'r4']) reporters.push(await createUser(name));

  section('SCENARIO 1: Genuine camera footage (image) -> HUMAN_VERIFIED badge');
  const aliceUpload = await uploadContent(alice, path.join(FIXTURES, 'camera_verified.jpg'), 'video');
  console.log(aliceUpload);

  section('SCENARIO 2: AI tool signature detected in metadata -> no badge');
  const bobUpload = await uploadContent(bob, path.join(FIXTURES, 'ai_generated.jpg'), 'video');
  console.log(bobUpload);

  section('SCENARIO 3: Edited but no camera tag -> UNVERIFIED');
  const edited = await uploadContent(alice, path.join(FIXTURES, 'edited_unknown.jpg'), 'video');
  console.log(edited);

  section('SCENARIO 4: Metadata stripped entirely (image) -> NO_METADATA');
  const stripped = await uploadContent(bob, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  console.log(stripped);

  section('SCENARIO 4b: Same four tiers, but with actual video files (.mp4/.h264)');
  console.log('camera_verified.mp4:', await uploadContent(alice, path.join(FIXTURES, 'camera_verified.mp4'), 'video'));
  console.log('ai_generated.mp4:', await uploadContent(bob, path.join(FIXTURES, 'ai_generated.mp4'), 'video'));
  console.log('edited_unknown.mp4:', await uploadContent(alice, path.join(FIXTURES, 'edited_unknown.mp4'), 'video'));
  console.log(
    'reencoded_no_camera_claim.mp4:',
    await uploadContent(bob, path.join(FIXTURES, 'reencoded_no_camera_claim.mp4'), 'video')
  );
  console.log('-> Note this one is EDITED_UNKNOWN, not NO_METADATA -- mp4/mov muxers auto-write their');
  console.log('   own encoder/handler tags even when "copied" metadata is stripped.');
  console.log(
    'truly_stripped.h264:',
    await uploadContent(bob, path.join(FIXTURES, 'truly_stripped.h264'), 'video')
  );
  console.log('-> This one genuinely has NO_METADATA: a raw elementary stream has no container to hold tags.');

  section('SCENARIO 5: Community reports pile up on the stripped-metadata post -> auto-flag');
  console.log(`Content ID under fire: ${stripped.contentId} (posted by bob_ai_slop)`);
  for (const reporterId of reporters) {
    const r = await fileReport(stripped.contentId, reporterId);
    console.log(` report from user ${reporterId}:`, r);
  }

  section('SCENARIO 6a: Creator appeals and WINS (false positive)');
  const winCase = await uploadContent(alice, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  for (const reporterId of reporters.slice(0, 3)) await fileReport(winCase.contentId, reporterId);
  const strikeForWin = await db.get(
    'SELECT * FROM strikes WHERE content_id = $1 ORDER BY id DESC LIMIT 1',
    [winCase.contentId]
  );
  console.log('Strike opened:', strikeForWin);
  const appealWin = await fileAppeal(strikeForWin.id, 'This is my own unedited phone footage.');
  console.log('Appeal filed:', appealWin);
  const resolvedWin = await resolveAppeal(appealWin.appealId, 'APPROVED');
  console.log('Appeal resolved:', resolvedWin);
  console.log(`-> Confirmed strikes for alice after winning appeal: ${await confirmedStrikeCount(alice)}`);

  section('SCENARIO 6b: Creator appeals and LOSES (report was right)');
  const strikeForBob = await db.get(
    'SELECT * FROM strikes WHERE content_id = $1 ORDER BY id DESC LIMIT 1',
    [stripped.contentId]
  );
  const appealLoss = await fileAppeal(strikeForBob.id, 'This is real, I swear.');
  console.log('Appeal filed:', appealLoss);
  const resolvedLoss = await resolveAppeal(appealLoss.appealId, 'DENIED');
  console.log('Appeal resolved:', resolvedLoss);
  console.log(`-> Confirmed strikes for bob now: ${await confirmedStrikeCount(bob)}`);

  section('SCENARIO 7: Repeated offenses escalate to a posting restriction');
  for (let i = 0; i < 3; i++) {
    const uploadResult = await uploadContent(bob, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
    if (!uploadResult.success) {
      console.log(`Upload attempt ${i + 1} blocked:`, uploadResult);
      continue;
    }
    let flaggedResult;
    for (const reporterId of reporters) {
      const r = await fileReport(uploadResult.contentId, reporterId);
      if (r.flagged) flaggedResult = r;
    }
    if (!flaggedResult) {
      console.log(`Round ${i + 1}: reports didn't cross the flag threshold this time -- skipping.`);
      continue;
    }
    const strike = await db.get(
      'SELECT * FROM strikes WHERE content_id = $1 ORDER BY id DESC LIMIT 1',
      [uploadResult.contentId]
    );
    const appeal = await fileAppeal(strike.id, 'not appealing much, just checking');
    await resolveAppeal(appeal.appealId, 'DENIED');
    console.log(
      `Round ${i + 1}: bob's confirmed strikes = ${await confirmedStrikeCount(bob)}, ` +
        `posting status = ${JSON.stringify(await canPost(bob))}`
    );
  }

  section('SCENARIO 8: Duplicate report + rate limiting guardrails');
  const dupe = await fileReport(stripped.contentId, reporters[0]);
  console.log('Same user reporting the same content twice:', dupe);

  section('SCENARIO 9: High-follower account -> fast-track review, NOT auto-badge');
  const carolUpload = await uploadContent(carol, path.join(FIXTURES, 'no_metadata.jpg'), 'video');
  console.log('Upload result:', carolUpload);
  console.log('Review priority for carol (50k followers):', await getReviewPriority(carol));

  section('SCENARIO 10: Auto-confirm strikes where the appeal window expired unused');
  const autoConfirmed = await autoConfirmExpiredStrikes();
  console.log('Auto-confirmed strike IDs (none expected -- nothing has aged 48h in this run):', autoConfirmed);

  section('DONE');
  console.log('Inspect the database directly (psql / any Postgres client) to see full table state.');
  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
