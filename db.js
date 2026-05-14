const Database = require('better-sqlite3');
const path     = require('path');

const db = new Database(path.join(__dirname, 'hotspot.db'));

/* ── Enable WAL mode for better concurrent performance ── */
db.pragma('journal_mode = WAL');

/* ──────────────────────────────────────────────────────
   SCHEMA
   users    — registered accounts
   sessions — active or paused internet sessions
────────────────────────────────────────────────────── */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE,
    phone           TEXT    NOT NULL,
    password_hash   TEXT    NOT NULL,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_ip           TEXT,
    plan_label        TEXT    NOT NULL,
    seconds_total     INTEGER NOT NULL,
    seconds_remaining INTEGER NOT NULL,
    is_active         INTEGER NOT NULL DEFAULT 0,  -- 1 = connected, 0 = paused
    paystack_ref      TEXT,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at        INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

/* ──────────────────────────────────────────────────────
   USER helpers
────────────────────────────────────────────────────── */
const userHelpers = {
  create: db.prepare(`
    INSERT INTO users (name, email, phone, password_hash)
    VALUES (@name, @email, @phone, @password_hash)
  `),

  findByEmail: db.prepare(`
    SELECT * FROM users WHERE email = ? COLLATE NOCASE
  `),

  findById: db.prepare(`
    SELECT * FROM users WHERE id = ?
  `),
};

/* ──────────────────────────────────────────────────────
   SESSION helpers
────────────────────────────────────────────────────── */
const sessionHelpers = {
  /* Get the most recent active or paused session for a user */
  findByUser: db.prepare(`
    SELECT * FROM sessions
    WHERE user_id = ? AND seconds_remaining > 0
    ORDER BY created_at DESC
    LIMIT 1
  `),

  /* Find by user IP — used for incoming connections */
  findByIp: db.prepare(`
    SELECT * FROM sessions
    WHERE user_ip = ? AND seconds_remaining > 0
    ORDER BY created_at DESC
    LIMIT 1
  `),

  create: db.prepare(`
    INSERT INTO sessions (user_id, user_ip, plan_label, seconds_total, seconds_remaining, is_active, paystack_ref)
    VALUES (@user_id, @user_ip, @plan_label, @seconds_total, @seconds_remaining, 1, @paystack_ref)
  `),

  setActive: db.prepare(`
    UPDATE sessions
    SET is_active = 1, user_ip = @user_ip, updated_at = strftime('%s','now')
    WHERE id = @id
  `),

  pause: db.prepare(`
    UPDATE sessions
    SET is_active = 0, seconds_remaining = @seconds_remaining, updated_at = strftime('%s','now')
    WHERE id = @id
  `),

  end: db.prepare(`
    UPDATE sessions
    SET is_active = 0, seconds_remaining = 0, updated_at = strftime('%s','now')
    WHERE id = @id
  `),

  updateIp: db.prepare(`
    UPDATE sessions SET user_ip = @user_ip WHERE id = @id
  `),
};

module.exports = { db, userHelpers, sessionHelpers };
