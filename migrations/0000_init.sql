-- Missive Mail — D1 Database Migration
-- Generated from src/schema/index.ts (Drizzle ORM)
-- Tables: users, mails, mail_bodies, attachments, labels, rules, agents, webhooks, audit_logs, login_history

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  totp_secret  TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,  -- boolean
  two_fa_verified_at INTEGER,                -- unix timestamp (seconds)
  created_at   INTEGER NOT NULL,             -- unix timestamp (seconds)
  updated_at   INTEGER NOT NULL              -- unix timestamp (seconds)
);

-- ─── Mails ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mails (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  from_addr    TEXT NOT NULL,
  to_addr      TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT '',
  folder       TEXT NOT NULL DEFAULT 'inbox',  -- enum: inbox|sent|draft|archive|spam
  is_read      INTEGER NOT NULL DEFAULT 0,     -- boolean
  is_starred   INTEGER NOT NULL DEFAULT 0,     -- boolean
  labels       TEXT DEFAULT '[]',              -- JSON string array
  importance   INTEGER NOT NULL DEFAULT 0,
  spam_score   REAL NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL                -- unix timestamp (seconds)
);

-- ─── Mail Bodies ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mail_bodies (
  id             TEXT PRIMARY KEY,
  mail_id        TEXT NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  text_content   TEXT,
  html_content   TEXT,
  raw_headers    TEXT                          -- JSON Record<string, string>
);

-- ─── Attachments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  mail_id    TEXT NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  filename   TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  r2_key     TEXT NOT NULL
);

-- ─── Labels ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labels (
  id      TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name    TEXT NOT NULL,
  color   TEXT NOT NULL DEFAULT '#3b82f6'
);

-- ─── Rules ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rules (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  conditions  TEXT NOT NULL,                   -- JSON Record<string, unknown>
  actions     TEXT NOT NULL,                   -- JSON Record<string, unknown>
  enabled     INTEGER NOT NULL DEFAULT 1,      -- boolean
  priority    INTEGER NOT NULL DEFAULT 0
);

-- ─── Agents ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  name               TEXT NOT NULL,
  api_key_hash       TEXT NOT NULL,
  permissions        TEXT NOT NULL DEFAULT '[]',  -- JSON string array
  signature_template TEXT,
  rate_limit         INTEGER NOT NULL DEFAULT 60, -- requests per minute
  enabled            INTEGER NOT NULL DEFAULT 1,  -- boolean
  created_at         INTEGER NOT NULL             -- unix timestamp (seconds)
);

-- ─── Webhooks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  url         TEXT NOT NULL,
  events      TEXT NOT NULL,                   -- JSON string array
  filter      TEXT,                            -- JSON Record<string, unknown>
  secret_hash TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,      -- boolean
  created_at  INTEGER NOT NULL                 -- unix timestamp (seconds)
);

-- ─── Audit Logs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  agent_id   TEXT REFERENCES agents(id),
  action     TEXT NOT NULL,
  details    TEXT,                             -- JSON Record<string, unknown>
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL                  -- unix timestamp (seconds)
);

-- ─── Login History ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_history (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  ip             TEXT,
  user_agent     TEXT,
  success        INTEGER NOT NULL,             -- boolean
  failure_reason TEXT,
  created_at     INTEGER NOT NULL              -- unix timestamp (seconds)
);

-- ═════════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════════

-- users
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- mails — primary query patterns
CREATE INDEX IF NOT EXISTS idx_mails_user_id   ON mails(user_id);
CREATE INDEX IF NOT EXISTS idx_mails_folder    ON mails(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_mails_from      ON mails(from_addr);
CREATE INDEX IF NOT EXISTS idx_mails_created   ON mails(created_at);
CREATE INDEX IF NOT EXISTS idx_mails_read      ON mails(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_mails_starred   ON mails(user_id, is_starred);
CREATE INDEX IF NOT EXISTS idx_mails_spam      ON mails(spam_score);

-- mail_bodies
CREATE INDEX IF NOT EXISTS idx_mail_bodies_mail ON mail_bodies(mail_id);

-- attachments
CREATE INDEX IF NOT EXISTS idx_attachments_mail ON attachments(mail_id);

-- labels
CREATE INDEX IF NOT EXISTS idx_labels_user ON labels(user_id);

-- rules
CREATE INDEX IF NOT EXISTS idx_rules_user     ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(user_id, priority);

-- agents
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);

-- webhooks
CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

-- audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent   ON audit_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- login_history
CREATE INDEX IF NOT EXISTS idx_login_user    ON login_history(user_id);
CREATE INDEX IF NOT EXISTS idx_login_created ON login_history(created_at);
CREATE INDEX IF NOT EXISTS idx_login_success ON login_history(user_id, success);
