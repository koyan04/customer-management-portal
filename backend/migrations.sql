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

-- Note: Run these statements against your Postgres DB (psql or a migration tool).
