-- Ensure the user_status_matview has a unique index on id so REFRESH MATERIALIZED VIEW CONCURRENTLY can be used.
DO $$
BEGIN
  IF to_regclass('public.user_status_matview') IS NOT NULL THEN
    -- create a unique index on id if it doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_index i ON c.oid = i.indrelid
      JOIN pg_class ic ON i.indexrelid = ic.oid
      WHERE c.relname = 'user_status_matview' AND ic.relname = 'user_status_matview_id_unique_idx'
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX user_status_matview_id_unique_idx ON user_status_matview (id)';
    END IF;
  END IF;
END
$$;
