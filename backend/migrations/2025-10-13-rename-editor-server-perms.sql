-- Migration: Rename editor_server_permissions -> viewer_server_permissions (safe copy/drop approach)
-- This migration creates the new table, copies existing rows, then drops the old table.
-- Run in a transaction. Backup before running.

BEGIN;

-- 1) Create the new table with the same columns (keep column name editor_id to avoid code changes)
CREATE TABLE IF NOT EXISTS viewer_server_permissions (
  id SERIAL PRIMARY KEY,
  editor_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(editor_id, server_id)
);

-- 2) Copy existing rows (if any) from the old table
INSERT INTO viewer_server_permissions (editor_id, server_id, created_at)
SELECT editor_id, server_id, created_at FROM editor_server_permissions
ON CONFLICT DO NOTHING;

-- 3) Drop the old table
DROP TABLE IF EXISTS editor_server_permissions;

COMMIT;

-- Notes:
-- - Column names are preserved (editor_id) so application SQL doesn't need column changes; only the table name changes.
-- - After applying this migration, update any other deployment artifacts or documentation that reference the old table name.
