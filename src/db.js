// src/db.js
// Uses Node's built-in SQLite (node:sqlite, experimental as of Node 22).
// Swap this module out for better-sqlite3 or postgres later without
// touching the rest of the codebase -- everything else talks to `db.prepare`.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    followers INTEGER NOT NULL DEFAULT 0,
    -- reporter_trust: how much weight this user's reports carry (0.1 - 3.0).
    -- Starts neutral, adjusted over time based on report accuracy.
    reporter_trust REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('video','post')),
    filename TEXT,
    -- metadata_tier is set once, at upload time, by the metadata checker.
    -- CAMERA_VERIFIED | EDITED_UNKNOWN | NO_METADATA | AI_SIGNATURE_DETECTED
    metadata_tier TEXT NOT NULL,
    -- status: LIVE | UNDER_REVIEW | REMOVED
    status TEXT NOT NULL DEFAULT 'LIVE',
    -- badge_tier: HUMAN_VERIFIED | UNVERIFIED | null (none earned yet)
    badge_tier TEXT,
    badge_revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id),
    reporter_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(content_id, reporter_id) -- one report per user per piece of content
  );

  CREATE TABLE IF NOT EXISTS strikes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content_id INTEGER NOT NULL REFERENCES content(id),
    -- status: PENDING (awaiting appeal window) | CONFIRMED | OVERTURNED
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id),
    strike_id INTEGER NOT NULL REFERENCES strikes(id),
    reason TEXT,
    -- status: PENDING | APPROVED (creator wins, strike overturned) | DENIED (strike confirmed)
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );
`);

module.exports = db;
