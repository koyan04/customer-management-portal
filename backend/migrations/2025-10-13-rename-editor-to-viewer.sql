-- Migration: Convert existing admin roles from 'EDITOR' to 'VIEWER'
-- Run this in your Postgres database connected to the app. Always backup before running migrations.

BEGIN;

-- 1) Update existing role values in admins table
UPDATE admins
SET role = 'VIEWER'
WHERE role = 'EDITOR' OR role = 'editor' OR role = 'Editor';

-- 2) Optionally, if there are other tables or columns referencing the string 'EDITOR' (e.g., logs or legacy tables), update them as needed.
-- For safety, do not rename tables in this automatic migration. If you want to rename editor_server_permissions table to viewer_server_permissions,
-- do that in a separate migration after confirming no code references remain.

COMMIT;

-- Notes:
-- - This script only updates the role values stored in the admins table. It does not rename tables or constraints.
-- - If you want a safe script to rename editor_server_permissions to viewer_server_permissions, I can generate that too but it needs extra steps
--   (drop/rename constraints, update foreign keys, and update any code references) and downtime planning.
