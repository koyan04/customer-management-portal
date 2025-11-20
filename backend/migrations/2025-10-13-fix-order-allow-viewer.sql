-- Migration (fixed order): convert existing 'EDITOR' -> 'VIEWER' first, then recreate admins_role_check
-- Backup recommended before running.

BEGIN;

-- 1) Normalize existing role strings
UPDATE admins SET role = 'VIEWER' WHERE role ILIKE 'editor';
UPDATE admins SET role = 'ADMIN' WHERE role ILIKE 'admin';

-- 2) Drop old constraint and create new one that includes VIEWER
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('ADMIN','VIEWER'));

COMMIT;

-- Notes: If you have other expected role values, add them to the CHECK clause.
