-- Correct order migration: drop constraint, update roles, then recreate constraint
-- Backup recommended.

BEGIN;

-- 1) Drop the existing check constraint so we can update rows to 'VIEWER'
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

-- 2) Update existing admin rows from 'EDITOR' to 'VIEWER'
UPDATE admins SET role = 'VIEWER' WHERE role ILIKE 'editor';

-- 3) Recreate the check constraint including 'VIEWER'
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('ADMIN','VIEWER'));

COMMIT;

-- End
