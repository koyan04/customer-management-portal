-- Convert existing pricing decimals to integer cents and store under keys price_*_cents
DO $$
DECLARE
  rec RECORD;
  d jsonb;
  pm numeric;
BEGIN
  FOR rec IN SELECT settings_key, data FROM app_settings WHERE settings_key = 'general' LOOP
    d := rec.data;
    -- compute cents, treat missing as 0
    pm := COALESCE((d->>'price_mini')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_mini_cents', (round(pm)::bigint));
    pm := COALESCE((d->>'price_basic')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_basic_cents', (round(pm)::bigint));
    pm := COALESCE((d->>'price_unlimited')::numeric, 0) * 100;
    d := d || jsonb_build_object('price_unlimited_cents', (round(pm)::bigint));
    -- optionally remove old keys (keep a backup field)
    d := d || jsonb_build_object('price_backup_decimal', jsonb_build_object('price_mini', COALESCE(d->>'price_mini','0'), 'price_basic', COALESCE(d->>'price_basic','0'), 'price_unlimited', COALESCE(d->>'price_unlimited','0')));
    d := d - 'price_mini' - 'price_basic' - 'price_unlimited';
    UPDATE app_settings SET data = d, updated_at = now() WHERE settings_key = rec.settings_key;
  END LOOP;
END$$;
