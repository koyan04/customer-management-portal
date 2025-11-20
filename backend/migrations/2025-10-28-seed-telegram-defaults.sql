-- Migration: seed defaults for telegram settings
-- Adds default notificationTime and toggles if missing

BEGIN;

-- If a telegram row exists, merge defaults without overwriting existing values
UPDATE app_settings
SET data = (
  ('{"notificationTime":"@daily","databaseBackup":false,"loginNotification":false}'::jsonb) || COALESCE(data, '{}'::jsonb)
), updated_at = now()
WHERE settings_key = 'telegram';

-- If no telegram row exists, insert defaults
INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
SELECT 'telegram', '{"notificationTime":"@daily","databaseBackup":false,"loginNotification":false}'::jsonb, NULL, now()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE settings_key = 'telegram');

-- Optionally record an audit entry for the backfill
INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data)
SELECT NULL, 'telegram', 'BACKFILL_DEFAULTS', NULL, data FROM app_settings WHERE settings_key = 'telegram';

COMMIT;
