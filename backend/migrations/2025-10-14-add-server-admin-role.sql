-- Allow SERVER_ADMIN role and create server_admin_permissions table
BEGIN;

-- Drop existing check constraint if present (safe to run multiple times)
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

-- Recreate check constraint with SERVER_ADMIN allowed
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('ADMIN', 'VIEWER', 'SERVER_ADMIN'));

-- Create server_admin_permissions table to map admins to servers they administer
CREATE TABLE IF NOT EXISTS server_admin_permissions (
  id serial PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id integer NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (admin_id, server_id)
);

COMMIT;
