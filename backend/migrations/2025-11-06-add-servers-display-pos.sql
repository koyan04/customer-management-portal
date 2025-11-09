-- Add persistent display position for servers so UI order can be rearranged and saved
-- 1) add column if missing
-- 2) backfill based on current display (created_at DESC) so the list looks unchanged initially
-- 3) add index for fast ordering

BEGIN;

ALTER TABLE servers ADD COLUMN IF NOT EXISTS display_pos integer;

-- Backfill using created_at DESC (newest first => smaller display_pos)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS rn
  FROM servers
)
UPDATE servers s
SET display_pos = n.rn
FROM numbered n
WHERE s.id = n.id AND (s.display_pos IS NULL OR s.display_pos = 0);

CREATE INDEX IF NOT EXISTS servers_display_pos_idx ON servers (display_pos);

COMMIT;
