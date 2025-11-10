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
-- Reconcile minimal pre-bootstrap schema (ensure all columns exist if table was created in a prior minimal form)
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    -- Add missing columns if needed (no-op if already present)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='service_type') THEN
      ALTER TABLE users ADD COLUMN service_type TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='contact') THEN
      ALTER TABLE users ADD COLUMN contact TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='expire_date') THEN
      ALTER TABLE users ADD COLUMN expire_date TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='total_devices') THEN
      ALTER TABLE users ADD COLUMN total_devices INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='data_limit_gb') THEN
      ALTER TABLE users ADD COLUMN data_limit_gb INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='remark') THEN
      ALTER TABLE users ADD COLUMN remark TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='display_pos') THEN
      ALTER TABLE users ADD COLUMN display_pos INTEGER;
    END IF;
    -- Ensure UNIQUE(server_id, account_name) via unique index (safe if constraint missing)
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS users_server_account_unique_idx ON users(server_id, account_name);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS users_server_id_idx ON users(server_id);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;
END$$;
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

-- Guard index creation in case users table is missing on mixed-state installs
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS users_server_id_idx ON users(server_id);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;
END$$;

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

-- Add persistent display position for users so client ordering can be preserved
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    -- Add persistent display position column if missing
    BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS display_pos integer;
    EXCEPTION WHEN undefined_table THEN
      -- table still doesn't exist; skip safely
      NULL;
    END;

    -- Populate with row_number per server ordered by created_at (older first -> smaller pos)
    BEGIN
      WITH numbered AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY created_at ASC) as rn
        FROM users
      )
      UPDATE users u
      SET display_pos = n.rn
      FROM numbered n
      WHERE u.id = n.id AND (u.display_pos IS NULL OR u.display_pos = 0);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;

    -- Create index if users table exists
    BEGIN
      CREATE INDEX IF NOT EXISTS users_display_pos_idx ON users (server_id, display_pos);
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;
END$$;

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

-- Backfill existing rows where service_type is NULL only if account_type column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'account_type'
  ) THEN
  EXECUTE 'UPDATE users SET service_type = account_type WHERE service_type IS NULL AND account_type IS NOT NULL';
  END IF;
END
$$;

-- Note: we keep `account_type` for a safe transition. Later you may rename or drop it once all code uses `service_type`.


