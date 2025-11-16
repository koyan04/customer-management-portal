-- Trigger enforcement requires updated_by NOT NULL & valid admin id for app_settings.general.
-- At this migration stage no admin may exist yet and previous migration left updated_by NULL.
-- Temporarily drop trigger, perform transformation without touching updated_by, then recreate.

DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;

DO $$
DECLARE
  rec RECORD;
  d jsonb;
  pm numeric;
BEGIN
  FOR rec IN SELECT settings_key, data FROM app_settings WHERE settings_key = 'general' LOOP
    d := rec.data;
    pm := COALESCE((d->>'price_mini')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_mini_cents', (round(pm)::bigint));
    pm := COALESCE((d->>'price_basic')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_basic_cents', (round(pm)::bigint));
    pm := COALESCE((d->>'price_unlimited')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_unlimited_cents', (round(pm)::bigint));
    d := d || jsonb_build_object('price_backup_decimal', jsonb_build_object(
      'price_mini', COALESCE(d->>'price_mini','0'),
      'price_basic', COALESCE(d->>'price_basic','0'),
      'price_unlimited', COALESCE(d->>'price_unlimited','0')
    ));
    d := d - 'price_mini' - 'price_basic' - 'price_unlimited';
    UPDATE app_settings SET data = d, updated_at = now() WHERE settings_key = rec.settings_key;
  END LOOP;
END$$;

CREATE TRIGGER trg_app_settings_enforce_general_updated_by
BEFORE INSERT OR UPDATE ON app_settings
FOR EACH ROW
WHEN (NEW.settings_key = 'general')
EXECUTE FUNCTION app_settings_enforce_general_updated_by();
