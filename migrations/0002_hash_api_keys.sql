-- Store API keys hashed (SHA-256) instead of in plaintext, and stop copying
-- raw keys into usage/log tables.
--
-- IRREVERSIBLE for log tables: plaintext keys in security_logs/audit_logs are
-- masked in place. Take a D1 Time Travel bookmark before applying remotely.
--
-- SQLite has no SHA-256, so existing keys move to `legacy_key`; the Worker
-- hashes each one on first use and clears the plaintext (see
-- src/utils/apiKeys.ts). New keys are only ever stored as `key_hash`.

PRAGMA defer_foreign_keys = on;

-- api_keys: rebuild (api_key was NOT NULL UNIQUE plaintext).
CREATE TABLE api_keys_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key_hash TEXT UNIQUE,
  legacy_key TEXT UNIQUE,
  key_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  CHECK (key_hash IS NOT NULL OR legacy_key IS NOT NULL)
);

INSERT INTO api_keys_new (id, user_id, legacy_key, key_hint, status, created_at)
SELECT
  id,
  user_id,
  api_key,
  CASE
    WHEN length(api_key) <= 16 THEN '••••••••'
    ELSE substr(api_key, 1, 12) || '••••' || substr(api_key, -4)
  END,
  status,
  created_at
FROM api_keys;

DROP TABLE api_keys;
ALTER TABLE api_keys_new RENAME TO api_keys;

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);

-- logs_summary: re-key by api_key_id (and carry tenant_id for scoped queries).
-- The old table is kept as logs_summary_legacy rather than dropped; remove it
-- once the backfill is verified. Rows that can't be attributed to a tenant
-- (keys of users created before users.tenant_id existed, so it is NULL)
-- are not carried over and remain only in logs_summary_legacy.
ALTER TABLE logs_summary RENAME TO logs_summary_legacy;

CREATE TABLE logs_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id INTEGER NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  total_requests INTEGER NOT NULL DEFAULT 0,
  blocked_requests INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO logs_summary (api_key_id, tenant_id, total_requests, blocked_requests, updated_at)
SELECT
  ak.id,
  u.tenant_id,
  -- Older schemas allowed NULL counters and duplicate api_key rows.
  COALESCE(SUM(ls.total_requests), 0),
  COALESCE(SUM(ls.blocked_requests), 0),
  MAX(ls.updated_at)
FROM logs_summary_legacy ls
INNER JOIN api_keys ak ON ak.legacy_key = ls.api_key
INNER JOIN users u ON u.id = ak.user_id
WHERE u.tenant_id IS NOT NULL
GROUP BY ak.id, u.tenant_id;

CREATE INDEX IF NOT EXISTS idx_logs_summary_tenant_blocked
ON logs_summary (tenant_id, blocked_requests DESC);

CREATE INDEX IF NOT EXISTS idx_logs_summary_blocked_v2
ON logs_summary (blocked_requests DESC);

-- security_logs / audit_logs: keep only a masked hint of the key.
ALTER TABLE security_logs RENAME COLUMN api_key TO api_key_hint;

UPDATE security_logs
SET api_key_hint = CASE
  WHEN length(api_key_hint) = 0 THEN api_key_hint
  WHEN length(api_key_hint) <= 16 THEN '••••••••'
  ELSE substr(api_key_hint, 1, 12) || '••••' || substr(api_key_hint, -4)
END
WHERE api_key_hint NOT LIKE '%••••%';

ALTER TABLE audit_logs RENAME COLUMN api_key TO api_key_hint;

UPDATE audit_logs
SET api_key_hint = CASE
  WHEN length(api_key_hint) <= 16 THEN '••••••••'
  ELSE substr(api_key_hint, 1, 12) || '••••' || substr(api_key_hint, -4)
END
WHERE api_key_hint IS NOT NULL
  AND api_key_hint NOT LIKE '%••••%';

-- Retention deletes by age (see scheduled handler).
CREATE INDEX IF NOT EXISTS idx_security_logs_created
ON security_logs (created_at);

-- Cached security intelligence, so Workers AI isn't called on every report.
CREATE TABLE IF NOT EXISTS ai_insights (
  tenant_id TEXT PRIMARY KEY,
  last_log_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
