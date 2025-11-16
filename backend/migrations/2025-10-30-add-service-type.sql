ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS service_type text;
UPDATE users SET service_type = account_type WHERE service_type IS NULL AND account_type IS NOT NULL;
