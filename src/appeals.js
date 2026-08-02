// src/appeals.js
// A strike only "counts" against a creator once it's CONFIRMED -- either
// because no appeal was filed within the window, or because an appeal was
// reviewed and denied. Filing an appeal itself doesn't clear anything; a
// human (or in this MVP, whoever calls resolveAppeal) has to decide it.

const db = require('./db');
const { adjustReporterTrust } = require('./reports');

const APPEAL_WINDOW_HOURS = 48;

/**
 * Creator disputes a pending strike.
 */
async function fileAppeal(strikeId, reason) {
  const strike = await db.get('SELECT * FROM strikes WHERE id = $1', [strikeId]);
  if (!strike) throw new Error(`No strike with id ${strikeId}`);
  if (strike.status !== 'PENDING') {
    return { filed: false, reason: `Strike is already ${strike.status}, not appealable.` };
  }

  const row = await db.get(
    'INSERT INTO appeals (content_id, strike_id, reason) VALUES ($1, $2, $3) RETURNING id',
    [strike.content_id, strikeId, reason || null]
  );

  return { filed: true, appealId: row.id };
}

/**
 * Resolve an appeal. `outcome` is 'APPROVED' (creator wins, strike overturned,
 * content restored to LIVE) or 'DENIED' (strike confirmed, content stays
 * removed). This is where a human moderator's decision plugs in.
 */
async function resolveAppeal(appealId, outcome) {
  if (!['APPROVED', 'DENIED'].includes(outcome)) {
    throw new Error("outcome must be 'APPROVED' or 'DENIED'");
  }

  const appeal = await db.get('SELECT * FROM appeals WHERE id = $1', [appealId]);
  if (!appeal) throw new Error(`No appeal with id ${appealId}`);

  const strikeStatus = outcome === 'APPROVED' ? 'OVERTURNED' : 'CONFIRMED';
  const contentStatus = outcome === 'APPROVED' ? 'LIVE' : 'REMOVED';

  await db.query("UPDATE appeals SET status = $1, resolved_at = now() WHERE id = $2", [
    outcome,
    appealId,
  ]);
  await db.query("UPDATE strikes SET status = $1, resolved_at = now() WHERE id = $2", [
    strikeStatus,
    appeal.strike_id,
  ]);
  await db.query('UPDATE content SET status = $1 WHERE id = $2', [contentStatus, appeal.content_id]);

  // Reward/penalize the reporters who flagged this content based on whether
  // they turned out to be right.
  await adjustReporterTrust(appeal.content_id, strikeStatus);

  // If the strike is confirmed, the badge (if any) is permanently revoked --
  // badges are revocable retroactively, not just forward-looking.
  if (strikeStatus === 'CONFIRMED') {
    await db.query('UPDATE content SET badge_revoked = true WHERE id = $1', [appeal.content_id]);
  }

  return { appealId, strikeId: appeal.strike_id, strikeStatus, contentStatus };
}

/**
 * For strikes where the appeal window has simply expired with no appeal
 * filed: auto-confirm. Call this periodically (e.g. a cron/scheduled job)
 * in a real deployment.
 */
async function autoConfirmExpiredStrikes() {
  const expired = await db.all(
    `SELECT s.* FROM strikes s
     LEFT JOIN appeals a ON a.strike_id = s.id
     WHERE s.status = 'PENDING'
       AND a.id IS NULL
       AND s.created_at <= now() - (interval '1 hour' * $1)`,
    [APPEAL_WINDOW_HOURS]
  );

  const confirmed = [];
  for (const strike of expired) {
    await db.query("UPDATE strikes SET status = 'CONFIRMED', resolved_at = now() WHERE id = $1", [
      strike.id,
    ]);
    await db.query("UPDATE content SET status = 'REMOVED', badge_revoked = true WHERE id = $1", [
      strike.content_id,
    ]);
    await adjustReporterTrust(strike.content_id, 'CONFIRMED');
    confirmed.push(strike.id);
  }
  return confirmed;
}

/**
 * Count of CONFIRMED (undisputed or lost-appeal) strikes for a user.
 * This is what should gate posting privileges and badge eligibility --
 * never raw report counts, and never PENDING strikes.
 */
async function confirmedStrikeCount(userId) {
  const row = await db.get(
    "SELECT COUNT(*)::int as c FROM strikes WHERE user_id = $1 AND status = 'CONFIRMED'",
    [userId]
  );
  return row.c;
}

module.exports = {
  fileAppeal,
  resolveAppeal,
  autoConfirmExpiredStrikes,
  confirmedStrikeCount,
  APPEAL_WINDOW_HOURS,
};
