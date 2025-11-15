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
  server_name TEXT NOT NULL
);

-- ==================================================================
-- Migration added: 2025-11-10 create users table (initial schema)
-- ==================================================================
-- Base users table required by subsequent migrations (display_pos, service_type) and import/export logic.
-- If this table already exists (legacy installs), the CREATE TABLE IF NOT EXISTS will be a no-op.
-- Columns:
--   account_name   : user/account identifier within a server (NOT NULL)
--   service_type   : tier/category (nullable; later backfilled or set via imports)
--   contact        : free-form contact info (nullable)
--   expire_date    : subscription/service expiry (nullable)
--   total_devices  : optional device count quota (nullable)
--   data_limit_gb  : optional data limit in GB (nullable)
--   remark         : free-form notes (nullable)
--   display_pos    : ordering position (added later; included here defensively for idempotency)
--   created_at     : row creation timestamp
-- Index/constraints:
--   UNIQUE(server_id, account_name) for fast upsert-by-name within a server
--   INDEX on server_id for common filtering
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  service_type TEXT,
  contact TEXT,
  expire_date TIMESTAMPTZ,
  total_devices INTEGER,
  data_limit_gb INTEGER,
  remark TEXT,
  display_pos INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(server_id, account_name)
);

-- Reconcile minimal pre-bootstrap schema (ensure all user columns exist)
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS expire_date TIMESTAMPTZ;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS total_devices INTEGER;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS data_limit_gb INTEGER;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS display_pos INTEGER;

-- Ensure indexes/constraints idempotently
CREATE UNIQUE INDEX IF NOT EXISTS users_server_account_unique_idx ON users(server_id, account_name);
CREATE INDEX IF NOT EXISTS users_server_id_idx ON users(server_id);

-- Table that maps editors to servers they may manage
CREATE TABLE IF NOT EXISTS editor_server_permissions (
  id SERIAL PRIMARY KEY,
  editor_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(editor_id, server_id)
);

-- Viewer permissions mapping (VIEWER role accounts to servers they can see)
CREATE TABLE IF NOT EXISTS viewer_server_permissions (
  id SERIAL PRIMARY KEY,
  editor_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(editor_id, server_id)
);

-- Server admin permissions mapping (ADMIN of specific servers; broader than VIEWER)
CREATE TABLE IF NOT EXISTS server_admin_permissions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(admin_id, server_id)
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

-- Add persistent display position column (safe if exists) and index
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS display_pos integer;
CREATE INDEX IF NOT EXISTS users_display_pos_idx ON users (server_id, display_pos);

-- ==================================================================
-- Migration added: 2025-10-27 add server_keys table
-- ==================================================================
-- Table to store per-server keys (api keys/ssh keys/other), used by Key Management UI
CREATE TABLE IF NOT EXISTS server_keys (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  username TEXT,
  description TEXT,
  original_key TEXT,
  generated_key TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS server_keys_server_id_idx ON server_keys(server_id);

-- ==================================================================
-- Migration added: 2025-10-30 add service_type to users and backfill
-- ==================================================================
-- Non-destructive migration: add `service_type` column and copy values from `account_type` when present.
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS service_type text;

-- Note: legacy backfill from account_type is skipped in DO-free mode; safe to ignore on fresh installs.

-- Note: we keep `account_type` for a safe transition. Later you may rename or drop it once all code uses `service_type`.

-- ==================================================================
-- Guardrails: protect app_settings.general from accidental deletion or
-- anonymous updates so only manual Admin UI saves may modify it.
-- ==================================================================
DO $$
DECLARE
  _fallback_admin INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM app_settings WHERE settings_key = 'general' AND updated_by IS NULL) THEN
    SELECT id INTO _fallback_admin FROM admins ORDER BY id LIMIT 1;
    IF _fallback_admin IS NOT NULL THEN
      UPDATE app_settings
         SET updated_by = _fallback_admin
       WHERE settings_key = 'general'
         AND updated_by IS NULL;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_settings_enforce_general_updated_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.settings_key = 'general' THEN
    IF NEW.updated_by IS NULL THEN
      RAISE EXCEPTION USING
        MESSAGE = 'app_settings.general updates must originate from the Admin UI save flow (updated_by required)';
    END IF;
    PERFORM 1 FROM admins WHERE id = NEW.updated_by;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        MESSAGE = format('app_settings.general updated_by % does not reference an existing admin', NEW.updated_by);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;
CREATE TRIGGER trg_app_settings_enforce_general_updated_by
BEFORE INSERT OR UPDATE ON app_settings
FOR EACH ROW
WHEN (NEW.settings_key = 'general')
EXECUTE FUNCTION app_settings_enforce_general_updated_by();

CREATE OR REPLACE FUNCTION app_settings_prevent_general_delete()
RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data)
    VALUES (OLD.updated_by, OLD.settings_key, 'DELETE_BLOCKED', OLD.data, NULL);
  EXCEPTION WHEN others THEN
    -- best-effort audit only; ignore failures so the primary error surfaces
  END;
  RAISE EXCEPTION USING
    MESSAGE = 'Deletion of app_settings.general is blocked; use the Admin UI to modify this record instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_settings_prevent_general_delete ON app_settings;
CREATE TRIGGER trg_app_settings_prevent_general_delete
BEFORE DELETE ON app_settings
FOR EACH ROW
WHEN (OLD.settings_key = 'general')
EXECUTE FUNCTION app_settings_prevent_general_delete();


