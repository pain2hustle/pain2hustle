-- FieldScan AI — D1 schema for per-user scan metering.
-- Apply with:  wrangler d1 execute fieldscan --file=schema.sql --remote

-- One row per user, holding their plan name (matches a key in plans.json).
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  plan    TEXT NOT NULL DEFAULT 'starter'
);

-- One row per (user, YYYY-MM). count = scans consumed that period.
CREATE TABLE IF NOT EXISTS usage (
  user_id TEXT NOT NULL,
  period  TEXT NOT NULL,          -- 'YYYY-MM'
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_usage_period ON usage(period);

-- Optional: seed a couple of test users.
-- INSERT INTO users (user_id, plan) VALUES ('demo-user','starter')
--   ON CONFLICT(user_id) DO UPDATE SET plan=excluded.plan;
