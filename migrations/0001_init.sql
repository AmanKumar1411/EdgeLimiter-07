CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password TEXT,
  role TEXT NOT NULL DEFAULT 'client',
  tenant_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id
ON users (tenant_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id
ON api_keys (user_id);

-- UNIQUE constraint prevents duplicate rows and enables safe UPSERT in the queue consumer.
CREATE TABLE IF NOT EXISTS logs_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key TEXT NOT NULL UNIQUE,
  total_requests INTEGER NOT NULL DEFAULT 0,
  blocked_requests INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_logs_summary_blocked
ON logs_summary (blocked_requests DESC);

CREATE TABLE IF NOT EXISTS security_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  route TEXT NOT NULL,
  ip_address TEXT,
  country TEXT,
  colo TEXT,
  user_agent TEXT,
  allowed INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  retry_after INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_logs_tenant_created
ON security_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_logs_ip_created
ON security_logs (ip_address, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  api_key TEXT,
  route TEXT,
  actor TEXT NOT NULL,
  action_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created
ON audit_logs (tenant_id, created_at DESC);
