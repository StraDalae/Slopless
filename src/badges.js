// src/badges.js
// Badge eligibility is decoupled from follower count -- see the README for
// why (follower count is a popularity signal, not a provenance signal).
// High-follower accounts get a FAST-TRACK REVIEW QUEUE instead of an
// auto-badge (getReviewPriority() below).

const { TIERS } = require('./metadata');
const { confirmedStrikeCount } = require('./appeals');
const db = require('./db');

const ENABLE_FOLLOWER_AUTO_BADGE = false; // see note above
const FAST_TRACK_FOLLOWER_THRESHOLD = 10000;

const BADGE = {
  HUMAN_VERIFIED: 'HUMAN_VERIFIED', // strongest claim: camera-verified capture, clean strike record
  UNVERIFIED: 'UNVERIFIED',         // no badge either way -- not flagged, but not provable either
  NONE: null,                       // AI signature detected, or badge revoked
};

/**
 * Compute (and persist) the badge tier for a piece of content at upload time.
 * Re-run this any time relevant state changes (e.g. after a strike is
 * confirmed) since badges are revocable retroactively.
 */
async function computeBadge(contentId) {
  const content = await db.get('SELECT * FROM content WHERE id = $1', [contentId]);
  if (!content) throw new Error(`No content with id ${contentId}`);

  if (content.badge_revoked) {
    await db.query('UPDATE content SET badge_tier = NULL WHERE id = $1', [contentId]);
    return BADGE.NONE;
  }

  if (content.metadata_tier === TIERS.AI_SIGNATURE_DETECTED) {
    await db.query('UPDATE content SET badge_tier = NULL WHERE id = $1', [contentId]);
    return BADGE.NONE;
  }

  const strikes = await confirmedStrikeCount(content.user_id);
  let tier;

  if (content.metadata_tier === TIERS.CAMERA_VERIFIED && strikes === 0) {
    tier = BADGE.HUMAN_VERIFIED;
  } else {
    tier = BADGE.UNVERIFIED;
  }

  await db.query('UPDATE content SET badge_tier = $1 WHERE id = $2', [tier, contentId]);
  return tier;
}

/**
 * Should this content get expedited human review (e.g. because the poster
 * has a large following and mistakes reach more people faster)? This is the
 * "fast-track" alternative to auto-badging high-follower accounts.
 */
async function getReviewPriority(userId) {
  const user = await db.get('SELECT * FROM users WHERE id = $1', [userId]);
  if (!user) throw new Error(`No user with id ${userId}`);
  return user.followers >= FAST_TRACK_FOLLOWER_THRESHOLD ? 'HIGH' : 'NORMAL';
}

module.exports = {
  computeBadge,
  getReviewPriority,
  BADGE,
  ENABLE_FOLLOWER_AUTO_BADGE,
  FAST_TRACK_FOLLOWER_THRESHOLD,
};
