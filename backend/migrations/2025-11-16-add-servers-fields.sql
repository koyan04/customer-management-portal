-- Add missing metadata columns to servers to align with API and UI
BEGIN;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS service_type TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS domain_name TEXT;
-- created_at was added in bootstrap; ensure it exists for older installs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='servers' AND column_name='created_at'
  ) THEN
    EXECUTE 'ALTER TABLE servers ADD COLUMN created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()';
  END IF;
END $$;
COMMIT;
