-- Nairaview accounts + portfolio schema (Cloudflare D1).
-- Apply once after creating the D1 database:
--   npx wrangler d1 execute nairaview-db --file schema.sql
-- (or paste into the D1 console in the Cloudflare dashboard)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  shares REAL NOT NULL,
  avg_cost REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, ticker)
);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
