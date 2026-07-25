// src/appeals.js
//
// Design decision from our discussion: a strike only "counts" against a
// creator once it's CONFIRMED -- either because no appeal was filed within
// the window, or because an appeal was reviewed and denied. Filing an
// appeal itself doesn't clear anything; a human (or in this MVP, whoever
// calls resolveAppeal) has to actually decide it.

const db = require('./db');
const { adjustReporterTrust } = require('./reports');

const APPEAL_WINDOW_HOURS = 48;

/**
 * Creator disputes a pending strike.
 */
function fileAppeal(strikeId, reason) {
  const strike = db.prepare('SELECT * FROM strikes WHERE id = ?').get(strikeId);
  if (!strike) throw new Error(`No strike with id ${strikeId}`);
  if (strike.status !== 'PENDING') {
    return { filed: false, reason: `Strike is already ${strike.status}, not appealable.` };
  }

  const result = db
    .prepare('INSERT INTO appeals (content_id, strike_id, reason) VALUES (?, ?, ?)')
    .run(strike.content_id, strikeId, reason || null);

  return { filed: true, appealId: result.lastInsertRowid };
}

/**
 * Resolve an appeal. `outcome` is 'APPROVED' (creator wins, strike overturned,
 * content restored to LIVE) or 'DENIED' (strike confirmed, content stays
 * removed). This is where a human moderator's decision plugs in.
 */
function resolveAppeal(appealId, outcome) {
  if (!['APPROVED', 'DENIED'].includes(outcome)) {
    throw new Error("outcome must be 'APPROVED' or 'DENIED'");
  }

  const appeal = db.prepare('SELECT * FROM appeals WHERE id = ?').get(appealId);
  if (!appeal) throw new Error(`No appeal with id ${appealId}`);

  const strikeStatus = outcome === 'APPROVED' ? 'OVERTURNED' : 'CONFIRMED';
  const contentStatus = outcome === 'APPROVED' ? 'LIVE' : 'REMOVED';

  db.prepare("UPDATE appeals SET status = ?, resolved_at = datetime('now') WHERE id = ?").run(
    outcome,
    appealId
  );
  db.prepare("UPDATE strikes SET status = ?, resolved_at = datetime('now') WHERE id = ?").run(
    strikeStatus,
    appeal.strike_id
  );
  db.prepare('UPDATE content SET status = ? WHERE id = ?').run(contentStatus, appeal.content_id);

  // Reward/penalize the reporters who flagged this content based on whether
  // they turned out to be right.
  adjustReporterTrust(appeal.content_id, strikeStatus);

  // If the strike is confirmed, the badge (if any) is permanently revoked --
  // badges are revocable retroactively, not just forward-looking.
  if (strikeStatus === 'CONFIRMED') {
    db.prepare('UPDATE content SET badge_revoked = 1 WHERE id = ?').run(appeal.content_id);
  }

  return { appealId, strikeId: appeal.strike_id, strikeStatus, contentStatus };
}

/**
 * For strikes where the appeal window has simply expired with no appeal
 * filed: auto-confirm. Call this periodically (e.g. a cron/scheduled job)
 * in a real deployment.
 */
function autoConfirmExpiredStrikes() {
  const expired = db
    .prepare(
      `SELECT s.* FROM strikes s
       LEFT JOIN appeals a ON a.strike_id = s.id
       WHERE s.status = 'PENDING'
         AND a.id IS NULL
         AND s.created_at <= datetime('now', ?)`
    )
    .all(`-${APPEAL_WINDOW_HOURS} hours`);

  const confirmed = [];
  for (const strike of expired) {
    db.prepare("UPDATE strikes SET status = 'CONFIRMED', resolved_at = datetime('now') WHERE id = ?").run(
      strike.id
    );
    db.prepare("UPDATE content SET status = 'REMOVED', badge_revoked = 1 WHERE id = ?").run(
      strike.content_id
    );
    adjustReporterTrust(strike.content_id, 'CONFIRMED');
    confirmed.push(strike.id);
  }
  return confirmed;
}

/**
 * Count of CONFIRMED (undisputed or lost-appeal) strikes for a user.
 * This is what should gate posting privileges and badge eligibility --
 * never raw report counts, and never PENDING strikes.
 */
function confirmedStrikeCount(userId) {
  const row = db
    .prepare(
      "SELECT COUNT(*) as c FROM strikes WHERE user_id = ? AND status = 'CONFIRMED'"
    )
    .get(userId);
  return row.c;
}

module.exports = {
  fileAppeal,
  resolveAppeal,
  autoConfirmExpiredStrikes,
  confirmedStrikeCount,
  APPEAL_WINDOW_HOURS,
};
