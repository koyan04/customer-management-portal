-- Backfill pricing cents into settings_audit.after_data for 'general' entries
-- This migration computes price_*_cents from existing keys in after_data:
-- 1) If price_*_cents already present, skip.
-- 2) If price_backup_decimal present, use those decimal values * 100.
-- 3) Else if legacy price_mini/price_basic/price_unlimited exist, use those * 100.
-- 4) Fallback to 0.
DO $$
DECLARE
  rec RECORD;
  d jsonb;
  pm numeric;
BEGIN
  FOR rec IN SELECT id, after_data FROM settings_audit WHERE settings_key = 'general' LOOP
    d := rec.after_data;
    -- if already has cents keys, continue
    IF (d ? 'price_mini_cents') OR (d ? 'price_basic_cents') OR (d ? 'price_unlimited_cents') THEN
      CONTINUE;
    END IF;

    -- compute price_mini_cents
    IF (d ? 'price_backup_decimal') THEN
      pm := COALESCE(((d->'price_backup_decimal'->>'price_mini')::numeric), 0) * 100;
    ELSE
      pm := COALESCE((d->>'price_mini')::numeric, 0) * 100;
    END IF;
    d := d || jsonb_build_object('price_mini_cents', (round(pm)::bigint));

    -- price_basic
    IF (d ? 'price_backup_decimal') THEN
      pm := COALESCE(((d->'price_backup_decimal'->>'price_basic')::numeric), 0) * 100;
    ELSE
      pm := COALESCE((d->>'price_basic')::numeric, 0) * 100;
    END IF;
    d := d || jsonb_build_object('price_basic_cents', (round(pm)::bigint));

    -- price_unlimited
    IF (d ? 'price_backup_decimal') THEN
      pm := COALESCE(((d->'price_backup_decimal'->>'price_unlimited')::numeric), 0) * 100;
    ELSE
      pm := COALESCE((d->>'price_unlimited')::numeric, 0) * 100;
    END IF;
    d := d || jsonb_build_object('price_unlimited_cents', (round(pm)::bigint));

    -- persist back
    UPDATE settings_audit SET after_data = d WHERE id = rec.id;
  END LOOP;
END$$;
