-- Add enabled/disabled flag to users
BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Optional index if many queries filter by enabled
CREATE INDEX IF NOT EXISTS idx_users_enabled ON users(enabled);

COMMIT;
