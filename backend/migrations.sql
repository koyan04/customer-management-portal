-- Migration snippets for Admin/Editor management

-- Table to store admin/editor accounts (if not already present)
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  avatar_data TEXT,
  role TEXT NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMP DEFAULT now()
);

-- Minimal servers table (created if missing) so permissions FK works
CREATE TABLE IF NOT EXISTS servers (
  id SERIAL PRIMARY KEY,
  server_name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

-- Table that maps editors to servers they may manage
CREATE TABLE IF NOT EXISTS editor_server_permissions (
  id SERIAL PRIMARY KEY,
  editor_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(editor_id, server_id)
);


-- Audit table for admin-initiated password resets
CREATE TABLE IF NOT EXISTS password_reset_audit (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE SET NULL,
  target_account_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  note TEXT
);

-- Application settings store (keyed by category)
-- We use a simple key -> JSONB model so we can evolve settings without schema changes
CREATE TABLE IF NOT EXISTS app_settings (
  settings_key TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Audit log for settings changes (who, what, before/after) for compliance
CREATE TABLE IF NOT EXISTS settings_audit (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  settings_key TEXT NOT NULL,
  action TEXT NOT NULL, -- 'UPDATE' | 'CREATE' | 'TEST'
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Note: Run these statements against your Postgres DB (psql or a migration tool).

-- Migration: create table to store invalidated token JTIs (added 2025-10-21)
CREATE TABLE IF NOT EXISTS invalidated_tokens (
  id SERIAL PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  admin_id INTEGER NULL,
  reason TEXT NULL,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invalidated_tokens_jti ON invalidated_tokens(jti);

-- Migration: create refresh_tokens table for rotating refresh-token cookie flow
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_admin_id ON refresh_tokens(admin_id);

-- ==================================================================
-- Migration added: 2025-10-21 add display_pos to users for stable order
-- ==================================================================

-- Add persistent display position for users so client ordering can be preserved
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS display_pos integer;

-- Populate with row_number per server ordered by created_at (older first -> smaller pos)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY created_at ASC) as rn
  FROM users
)
UPDATE users u
SET display_pos = n.rn
FROM numbered n
WHERE u.id = n.id AND (u.display_pos IS NULL OR u.display_pos = 0);

CREATE INDEX IF NOT EXISTS users_display_pos_idx ON users (server_id, display_pos);

