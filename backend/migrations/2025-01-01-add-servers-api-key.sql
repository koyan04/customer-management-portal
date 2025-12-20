-- Add api_key column to servers table
-- This migration adds support for storing API keys per server

DO $$
BEGIN
  -- Check if api_key column already exists
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'servers'
    AND column_name = 'api_key'
  ) THEN
    -- Add api_key column
    ALTER TABLE public.servers
    ADD COLUMN api_key character varying(500);
    
    RAISE NOTICE 'Column api_key added to servers table';
  ELSE
    RAISE NOTICE 'Column api_key already exists in servers table';
  END IF;
END $$;
