-- Enable telegram backup and set notification time to 1 minute (merge into existing settings)
INSERT INTO app_settings (settings_key, data, updated_at)
VALUES ('telegram', '{"login_database_backup": true, "notificationTime": 1}'::jsonb, now())
ON CONFLICT (settings_key) DO UPDATE SET data = app_settings.data || EXCLUDED.data, updated_at = now();
