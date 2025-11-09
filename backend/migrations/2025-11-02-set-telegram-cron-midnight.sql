-- Ensure a 'telegram' settings row exists
INSERT INTO app_settings (settings_key, data, updated_at)
VALUES ('telegram', '{}'::jsonb, now())
ON CONFLICT (settings_key) DO NOTHING;

-- Set a sensible default cron (daily at midnight) only if not already present
UPDATE app_settings
SET data = jsonb_set(data, '{notification,cron}', to_jsonb('0 0 * * *'::text), true),
    updated_at = now()
WHERE settings_key = 'telegram'
  AND (data->'notification' IS NULL OR (data->'notification' ? 'cron') IS FALSE);

-- Set a default timezone only if missing (use UTC by default)
UPDATE app_settings
SET data = jsonb_set(data, '{notification,timezone}', to_jsonb('UTC'::text), true),
    updated_at = now()
WHERE settings_key = 'telegram'
  AND (data->'notification' IS NULL OR (data->'notification' ? 'timezone') IS FALSE);

-- Remove legacy minute-based notification keys if present
UPDATE app_settings
SET data = (data - 'notificationTime' - 'notification_minutes' - 'notificationTimeMinutes'),
    updated_at = now()
WHERE settings_key = 'telegram';
