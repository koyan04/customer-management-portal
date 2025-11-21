# Release Notes — v1.1.1

Date: 2025-11-17

## Highlights
- Migration fix: `2025-10-23-add-pricing-defaults.sql` previously attempted to set `updated_by = 'system_migration'` (text) on `app_settings.general`, but the column is an integer referencing `admins.id` and an enforcement trigger requires a valid admin id. On fresh installs (before admins are seeded) this caused: `invalid input syntax for type integer: "system_migration"` and aborted the per-file migration run.
- Resolution: The migration now temporarily drops the `trg_app_settings_enforce_general_updated_by` trigger, inserts or updates pricing keys without specifying `updated_by`, then recreates the trigger. This preserves protection for future Admin UI updates while allowing bootstrapping without seeded admins.

## Changes
- fix(migrations): Rewrite pricing defaults migration to avoid invalid `updated_by` value and handle trigger lifecycle safely.
- chore(version): Bump `VERSION` to `cmp ver 1.1.1`.
- docs(readme): Mark 1.1.1 as latest; provide upgrade guidance.

## Detailed Migration Patch
Previous failing pattern (simplified):
```sql
INSERT ... updated_by = 'system_migration';  -- invalid integer
UPDATE ... SET updated_by = 'system_migration';
```

New logic:
```sql
DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;
DO $$ ... (INSERT/UPDATE without updated_by) $$;
CREATE TRIGGER trg_app_settings_enforce_general_updated_by ...;
```

## Upgrade Guidance
### If you installed v1.1.0 and saw the migration error
Run:
```bash
cd /srv/cmp/backend
git pull origin main   # if git checkout
node run_migrations.js
```
This will replay the corrected migration file; all earlier successful migrations remain applied.

### If you installed v1.1.0 and migrations succeeded
No action is required; the faulty migration did not run (likely path difference) or admin data existed. Upgrading to 1.1.1 is optional.

### Fresh install of v1.1.1
No special handling needed; installer proceeds normally.

## One-off SQL (Manual Fix Option)
If you prefer not to pull code, execute this in `psql` as a superuser/admin:
```sql
DROP TRIGGER IF EXISTS trg_app_settings_enforce_general_updated_by ON app_settings;
DO $$
DECLARE existing jsonb; next jsonb; BEGIN
  SELECT data INTO existing FROM app_settings WHERE settings_key='general';
  IF existing IS NULL THEN
    next := jsonb_build_object('price_mini',0,'price_basic',0,'price_unlimited',0,'currency','USD');
    INSERT INTO app_settings (settings_key,data,updated_at) VALUES ('general', next, now()) ON CONFLICT (settings_key) DO NOTHING;
  ELSE
    next := existing || jsonb_build_object(
      'price_mini', COALESCE(existing->>'price_mini','0')::numeric,
      'price_basic', COALESCE(existing->>'price_basic','0')::numeric,
      'price_unlimited', COALESCE(existing->>'price_unlimited','0')::numeric,
      'currency', COALESCE(existing->>'currency','USD')
    );
    UPDATE app_settings SET data = next, updated_at = now() WHERE settings_key='general';
  END IF;
END$$;
CREATE TRIGGER trg_app_settings_enforce_general_updated_by
BEFORE INSERT OR UPDATE ON app_settings
FOR EACH ROW WHEN (NEW.settings_key='general')
EXECUTE FUNCTION app_settings_enforce_general_updated_by();
```

## Verification Checklist
- `VERSION` file reads `cmp ver 1.1.1`.
- `backend/migrations/2025-10-23-add-pricing-defaults.sql` contains DROP TRIGGER / DO block / CREATE TRIGGER sequence.
- Running `node run_migrations.js` no longer raises integer cast error.
- README shows 1.1.1 as latest.

## Known Issues (unchanged from 1.1.0)
- DNS propagation timing for certbot Cloudflare plugin may require adjusting `CMP_DNS_PROPAGATION_SECONDS`.
- Large XLSX imports depend on server memory and configured limits; consider pagination/backpressure for very large datasets.

## Thanks
Thank you for reporting the migration failure quickly—it enabled a fast corrective release.
