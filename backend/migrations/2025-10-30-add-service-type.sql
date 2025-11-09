-- Add service_type column to users and backfill from existing account_type
-- Non-destructive: keep account_type in place for the transition
BEGIN;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS service_type text;

-- Backfill service_type from account_type for existing rows only when service_type is NULL
UPDATE users
SET service_type = account_type
WHERE service_type IS NULL AND account_type IS NOT NULL;

COMMIT;

-- Down / rollback (removes the service_type column)
-- Note: rolling back will drop data in service_type; run only if safe to lose that column.
-- To apply rollback, run the statements below in a migration rollback step:
-- ALTER TABLE users DROP COLUMN IF EXISTS service_type;
