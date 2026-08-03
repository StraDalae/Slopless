// src/auth.js
// Google Sign-In verification + our own short-lived session JWTs.
//
// Flow: the frontend uses Google Identity Services to get an ID token
// (a JWT signed by Google, proving who the person is), and POSTs it to
// POST /auth/google. We verify it against Google's public keys, upsert a
// user row keyed by Google's stable `sub` (subject) id, and issue our OWN
// JWT containing {id, email, isAdmin, username}. The frontend attaches
// that JWT as `Authorization: Bearer <token>` on every subsequent request;
// requireAuth() below verifies it and sets req.user. This is what "you can
// only act as yourself" actually means here -- every route that used to
// trust a client-supplied userId now reads req.user.id instead, which can
// only have been set by a token we ourselves signed after verifying Google.
//
// Admin status: whoever's email matches ADMIN_EMAIL (an env var you set
// yourself, never hardcoded) gets is_admin = true, recomputed on every
// login. Nobody can grant themselves admin by messing with client state --
// it's decided server-side from a verified email address.

const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const db = require('./db');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_TTL = '30d';

if (!GOOGLE_CLIENT_ID) {
  console.warn('[auth] GOOGLE_CLIENT_ID is not set -- Google sign-in verification will fail.');
}
if (!JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set -- sessions cannot be signed. Set a long random string.');
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Verify a Google ID token (the `credential` string from Google Identity
 * Services on the frontend) and return the decoded, trustworthy profile.
 */
async function verifyGoogleIdToken(idToken) {
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified,
    name: payload.name || payload.email,
    picture: payload.picture,
  };
}

/**
 * Find or create the local user row for a verified Google profile, and
 * recompute admin status from ADMIN_EMAIL every login.
 */
async function upsertUserFromGoogle(profile) {
  const isAdmin = !!ADMIN_EMAIL && profile.email.toLowerCase() === ADMIN_EMAIL;

  const existing = await db.get('SELECT * FROM users WHERE google_sub = $1', [profile.sub]);
  if (existing) {
    return db.get(
      `UPDATE users SET username = $1, avatar_url = $2, is_admin = $3 WHERE id = $4 RETURNING *`,
      [profile.name, profile.picture, isAdmin, existing.id]
    );
  }

  return db.get(
    `INSERT INTO users (username, email, google_sub, avatar_url, is_admin)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [profile.name, profile.email, profile.sub, profile.picture, isAdmin]
  );
}

function signSession(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.is_admin, username: user.username },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

function verifySession(token) {
  return jwt.verify(token, JWT_SECRET); // throws if invalid/expired
}

/** Express middleware: require a valid session, sets req.user. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not signed in.' });
  try {
    req.user = verifySession(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid -- please sign in again.' });
  }
}

/** Express middleware: require an authenticated admin. Chain after requireAuth. */
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = {
  verifyGoogleIdToken,
  upsertUserFromGoogle,
  signSession,
  verifySession,
  requireAuth,
  requireAdmin,
};
