// src/reports.js
//
// Handles community reporting. Design decisions (from our discussion):
// - Reports are weighted by reporter trust, not counted 1-for-1, to reduce
//   the value of brigading with throwaway/new accounts.
// - Crossing the threshold does NOT instantly remove content. It moves
//   content to UNDER_REVIEW (reduced distribution) and opens a strike in
//   PENDING status. Only a human/appeal-resolved outcome makes it CONFIRMED.
// - A basic per-day report rate limit is enforced per reporting user to
//   blunt simple brigading scripts. A production system would also want
//   timing-cluster detection (many reports arriving in a tight window from
//   accounts with no other engagement) -- noted here, not implemented in
//   this MVP.

const db = require('./db');

const REPORT_WEIGHT_THRESHOLD = 3.0; // sum of weighted reports needed to flag
const MAX_REPORTS_PER_USER_PER_DAY = 20; // simple anti-brigading limiter

function getUser(userId) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error(`No user with id ${userId}`);
  return row;
}

function reportsFromUserToday(userId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as c FROM reports
       WHERE reporter_id = ? AND created_at >= datetime('now', '-1 day')`
    )
    .get(userId);
  return row.c;
}

/**
 * File a report against a piece of content.
 * Returns what happened: whether it was recorded, and whether the content
 * just crossed the auto-flag threshold.
 */
function fileReport(contentId, reporterId) {
  const reporter = getUser(reporterId);

  if (reportsFromUserToday(reporterId) >= MAX_REPORTS_PER_USER_PER_DAY) {
    return { recorded: false, reason: 'RATE_LIMITED' };
  }

  try {
    db.prepare(
      'INSERT INTO reports (content_id, reporter_id) VALUES (?, ?)'
    ).run(contentId, reporterId);
  } catch (err) {
    // UNIQUE constraint -- this user already reported this content
    return { recorded: false, reason: 'ALREADY_REPORTED' };
  }

  const weightRow = db
    .prepare(
      `SELECT COALESCE(SUM(u.reporter_trust), 0) as weight, COUNT(*) as count
       FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.content_id = ?`
    )
    .get(contentId);

  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);

  if (weightRow.weight >= REPORT_WEIGHT_THRESHOLD && content.status === 'LIVE') {
    // Cross threshold: reduce distribution + open a strike, but do NOT
    // hard-delete. Creator gets notified (in a real system: push/email) and
    // can appeal before it becomes a confirmed strike.
    db.prepare("UPDATE content SET status = 'UNDER_REVIEW' WHERE id = ?").run(contentId);
    const strikeResult = db
      .prepare('INSERT INTO strikes (user_id, content_id, status) VALUES (?, ?, ?)')
      .run(content.user_id, contentId, 'PENDING');

    return {
      recorded: true,
      flagged: true,
      strikeId: strikeResult.lastInsertRowid,
      totalWeight: weightRow.weight,
      totalReports: weightRow.count,
    };
  }

  return {
    recorded: true,
    flagged: false,
    totalWeight: weightRow.weight,
    totalReports: weightRow.count,
  };
}

/**
 * Adjust a reporter's trust score after a strike they contributed to is
 * resolved. Called by appeals.js when a strike is confirmed or overturned.
 * Trust nudges are small and clamped so no single vote swings things hard.
 */
function adjustReporterTrust(contentId, direction) {
  const reporterIds = db
    .prepare('SELECT reporter_id FROM reports WHERE content_id = ?')
    .all(contentId)
    .map((r) => r.reporter_id);

  const delta = direction === 'CONFIRMED' ? 0.05 : -0.1; // wrong reports cost more trust than right ones earn
  for (const id of reporterIds) {
    const user = getUser(id);
    const next = Math.min(3.0, Math.max(0.1, user.reporter_trust + delta));
    db.prepare('UPDATE users SET reporter_trust = ? WHERE id = ?').run(next, id);
  }
}

module.exports = {
  fileReport,
  adjustReporterTrust,
  REPORT_WEIGHT_THRESHOLD,
  MAX_REPORTS_PER_USER_PER_DAY,
};
