// src/badges.js
//
// Design decision from our discussion: badge eligibility is decoupled from
// follower count. A big follower count is a popularity signal, not a
// provenance signal, and "auto-badge above X followers" is an easy target
// for someone who farms followers on real content then slips in AI content
// once they're past the threshold.
//
// Instead: every piece of content is judged on its own metadata tier +
// the poster's confirmed-strike history. High-follower accounts get a
// FAST-TRACK REVIEW QUEUE (reviewed sooner, not skipped) -- see
// getReviewPriority() below. Flip ENABLE_FOLLOWER_AUTO_BADGE if you want
// to test the original always-badge behavior anyway, but the risk above
// is real and this defaults to off.

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
function computeBadge(contentId) {
  const content = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId);
  if (!content) throw new Error(`No content with id ${contentId}`);

  if (content.badge_revoked) {
    db.prepare('UPDATE content SET badge_tier = NULL WHERE id = ?').run(contentId);
    return BADGE.NONE;
  }

  if (content.metadata_tier === TIERS.AI_SIGNATURE_DETECTED) {
    db.prepare('UPDATE content SET badge_tier = NULL WHERE id = ?').run(contentId);
    return BADGE.NONE;
  }

  const strikes = confirmedStrikeCount(content.user_id);
  let tier;

  if (content.metadata_tier === TIERS.CAMERA_VERIFIED && strikes === 0) {
    tier = BADGE.HUMAN_VERIFIED;
  } else {
    // EDITED_UNKNOWN or NO_METADATA -> can't make the strong claim either way
    tier = BADGE.UNVERIFIED;
  }

  db.prepare('UPDATE content SET badge_tier = ? WHERE id = ?').run(tier, contentId);
  return tier;
}

/**
 * Should this content get expedited human review (e.g. because the poster
 * has a large following and mistakes reach more people faster)? This is the
 * "fast-track" alternative to auto-badging high-follower accounts.
 */
function getReviewPriority(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
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
