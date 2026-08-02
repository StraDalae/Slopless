// src/restrictions.js
// Temporary posting restrictions based on CONFIRMED strikes only (never
// pending ones -- see appeals.js for why).

const { confirmedStrikeCount } = require('./appeals');

// strikeCount -> restriction duration in hours. Escalating.
const RESTRICTION_LADDER = [
  { atStrikes: 3, hours: 24 },
  { atStrikes: 5, hours: 24 * 7 },
  { atStrikes: 8, hours: 24 * 30 },
];

/**
 * Given a user's confirmed strike count, determine if/how long they should
 * be restricted from posting new content. Returns null if not restricted.
 */
async function getRestriction(userId) {
  const strikes = await confirmedStrikeCount(userId);
  const rung = [...RESTRICTION_LADDER].reverse().find((r) => strikes >= r.atStrikes);
  if (!rung) return null;
  return { strikes, restrictedForHours: rung.hours };
}

async function canPost(userId) {
  const restriction = await getRestriction(userId);
  return { allowed: restriction === null, restriction };
}

module.exports = { getRestriction, canPost, RESTRICTION_LADDER };
