// src/reports.js
// Handles community reporting. Design decisions (from our discussion):
// - Reports are weighted by reporter trust, not counted 1-for-1, to reduce
//   the value of brigading with throwaway/new accounts.
// - Crossing the threshold does NOT instantly remove content. It moves
//   content to UNDER_REVIEW (reduced distribution) and opens a strike in
//   PENDING status. Only a human/appeal-resolved outcome makes it CONFIRMED.
// - A basic per-day report rate limit is enforced per reporting user to
//   blunt simple brigading scripts. A production system would also want
//   timing-cluster detection -- noted here, not implemented in this MVP.

const db = require('./db');

const REPORT_WEIGHT_THRESHOLD = 3.0; // sum of weighted reports needed to flag
const MAX_REPORTS_PER_USER_PER_DAY = 20; // simple anti-brigading limiter

async function getUser(userId) {
  const row = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
  if (!row) throw new Error(`No user with id ${userId}`);
  return row;
}

async function reportsFromUserToday(userId) {
  const row = await db.get(
    `SELECT COUNT(*)::int as c FROM reports
     WHERE reporter_id = $1 AND created_at >= now() - interval '1 day'`,
    [userId]
  );
  return row.c;
}

/**
 * File a report against a piece of content.
 * Returns what happened: whether it was recorded, and whether the content
 * just crossed the auto-flag threshold.
 */
async function fileReport(contentId, reporterId) {
  await getUser(reporterId); // throws if reporter doesn't exist

  if ((await reportsFromUserToday(reporterId)) >= MAX_REPORTS_PER_USER_PER_DAY) {
    return { recorded: false, reason: 'RATE_LIMITED' };
  }

  try {
    await db.query('INSERT INTO reports (content_id, reporter_id) VALUES ($1, $2)', [
      contentId,
      reporterId,
    ]);
  } catch (err) {
    if (err.code === '23505') {
      // unique_violation -- this user already reported this content
      return { recorded: false, reason: 'ALREADY_REPORTED' };
    }
    throw err;
  }

  const weightRow = await db.get(
    `SELECT COALESCE(SUM(u.reporter_trust), 0) as weight, COUNT(*)::int as count
     FROM reports r JOIN users u ON u.id = r.reporter_id
     WHERE r.content_id = $1`,
    [contentId]
  );
  const weight = Number(weightRow.weight);

  const content = await db.get('SELECT * FROM content WHERE id = $1', [contentId]);

  if (weight >= REPORT_WEIGHT_THRESHOLD && content.status === 'LIVE') {
    // Cross threshold: reduce distribution + open a strike, but do NOT
    // hard-delete. Creator gets notified (in a real system: push/email) and
    // can appeal before it becomes a confirmed strike.
    await db.query("UPDATE content SET status = 'UNDER_REVIEW' WHERE id = $1", [contentId]);
    const strikeRow = await db.get(
      'INSERT INTO strikes (user_id, content_id, status) VALUES ($1, $2, $3) RETURNING id',
      [content.user_id, contentId, 'PENDING']
    );

    return {
      recorded: true,
      flagged: true,
      strikeId: strikeRow.id,
      totalWeight: weight,
      totalReports: weightRow.count,
    };
  }

  return {
    recorded: true,
    flagged: false,
    totalWeight: weight,
    totalReports: weightRow.count,
  };
}

/**
 * Adjust a reporter's trust score after a strike they contributed to is
 * resolved. Called by appeals.js when a strike is confirmed or overturned.
 * Trust nudges are small and clamped so no single vote swings things hard.
 */
async function adjustReporterTrust(contentId, direction) {
  const reporters = await db.all('SELECT reporter_id FROM reports WHERE content_id = $1', [
    contentId,
  ]);

  const delta = direction === 'CONFIRMED' ? 0.05 : -0.1; // wrong reports cost more trust than right ones earn
  for (const { reporter_id: id } of reporters) {
    const user = await getUser(id);
    const next = Math.min(3.0, Math.max(0.1, user.reporter_trust + delta));
    await db.query('UPDATE users SET reporter_trust = $1 WHERE id = $2', [next, id]);
  }
}

module.exports = {
  fileReport,
  adjustReporterTrust,
  REPORT_WEIGHT_THRESHOLD,
  MAX_REPORTS_PER_USER_PER_DAY,
};
