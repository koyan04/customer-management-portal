-- Add service_type column to users and backfill from existing account_type if present.
-- Idempotent: guards on column existence; safe on re-run.
DO $$
BEGIN
  -- Add column if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'service_type'
  ) THEN
    ALTER TABLE users ADD COLUMN service_type text;
  END IF;

  -- Backfill only if legacy account_type column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'account_type'
  ) THEN
    EXECUTE 'UPDATE users SET service_type = account_type WHERE service_type IS NULL AND account_type IS NOT NULL';
  END IF;
END $$;

-- Rollback (manual): ALTER TABLE users DROP COLUMN IF EXISTS service_type;
