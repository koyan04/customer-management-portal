-- Add a dedicated role column to telegram_login_notify_audit and backfill from payload
ALTER TABLE IF EXISTS telegram_login_notify_audit ADD COLUMN IF NOT EXISTS role TEXT;

-- Backfill role from payload JSON if present
UPDATE telegram_login_notify_audit
SET role = payload->> 'role'
WHERE payload ? 'role' AND (role IS NULL OR role = '');

-- Index to speed queries by role (optional)
CREATE INDEX IF NOT EXISTS idx_telegram_login_notify_audit_role ON telegram_login_notify_audit(role);
