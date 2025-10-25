-- Add persistent display position for users so client ordering can be preserved
-- 1) add column
-- 2) populate for existing rows per-server using created_at ordering
-- 3) add an index to make ordering fast

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_pos integer;

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

COMMIT;
