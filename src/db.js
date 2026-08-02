// src/db.js
// Postgres-backed persistence (swapped from the local-only node:sqlite
// version so deployed state actually survives between requests -- Vercel's
// serverless functions have no persistent local disk).
//
// Works with Vercel Postgres, Neon, Supabase, or any standard Postgres --
// just needs a connection string in POSTGRES_URL (Vercel Postgres/Neon
// integrations inject this automatically once connected to the project).
//
// Everything here is async now (unlike the old node:sqlite version, which
// was synchronous) -- every module that touches the DB awaits these calls.

const { Pool } = require('pg');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn(
    '[db] No POSTGRES_URL or DATABASE_URL set. DB calls will fail until one is configured ' +
      '(Vercel Storage tab -> connect a Postgres database -> redeploy).'
  );
}

const pool = new Pool({
  connectionString,
  // Most managed Postgres providers (Vercel Postgres/Neon/Supabase) require
  // SSL and use certs that Node's default trust store won't chain-validate
  // cleanly in this simple setup. Fine for an MVP; tighten for production.
  ssl: connectionString && !connectionString.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    followers INTEGER NOT NULL DEFAULT 0,
    reporter_trust REAL NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS content (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('video','post')),
    filename TEXT,
    metadata_tier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'LIVE',
    badge_tier TEXT,
    badge_revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    content_id INTEGER NOT NULL REFERENCES content(id),
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(content_id, reporter_id)
  );

  CREATE TABLE IF NOT EXISTS strikes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content_id INTEGER NOT NULL REFERENCES content(id),
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id SERIAL PRIMARY KEY,
    content_id INTEGER NOT NULL REFERENCES content(id),
    strike_id INTEGER NOT NULL REFERENCES strikes(id),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  );
`;

// Schema creation is async (unlike sqlite's synchronous exec), so we cache
// the init promise and make every query wait on it once, on cold start.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(SCHEMA).catch((err) => {
      schemaReady = null; // allow retry on next call if it failed
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Run a query. Params use Postgres-style $1, $2... placeholders.
 * Returns the full pg result object ({ rows, rowCount, ... }).
 */
async function query(text, params = []) {
  await ensureSchema();
  return pool.query(text, params);
}

/** Run a query, return the first row (or undefined). */
async function get(text, params = []) {
  const res = await query(text, params);
  return res.rows[0];
}

/** Run a query, return all rows. */
async function all(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}

module.exports = { pool, query, get, all, ensureSchema };
