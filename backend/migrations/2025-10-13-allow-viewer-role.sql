-- Migration: Allow 'VIEWER' in admins.role constraint and convert existing 'EDITOR' values
-- This migration drops and recreates the admins_role_check constraint to include VIEWER,
-- then updates any existing admin rows with role 'EDITOR' to 'VIEWER'.
-- Backup your DB before running.

BEGIN;

-- Drop existing check (if any) and recreate with allowed values including VIEWER
ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;
ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK (role IN ('ADMIN','VIEWER'));

-- Convert existing rows (case-insensitive match for 'editor')
UPDATE admins SET role = 'VIEWER' WHERE role ILIKE 'editor';

COMMIT;

-- Notes:
-- If your application has other role values (e.g., SUPERADMIN), modify the CHECK clause to include them.
-- If you prefer not to drop the constraint, you can ALTER CONSTRAINT using a more complex approach, but dropping/recreating is straightforward for dev databases.
