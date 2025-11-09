-- Create audit table for Telegram login notifications and per-chat notification overrides
CREATE TABLE IF NOT EXISTS telegram_login_notify_audit (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT,
  admin_id INTEGER,
  username TEXT,
  ip TEXT,
  user_agent TEXT,
  status TEXT,
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_chat_notifications (
  chat_id BIGINT PRIMARY KEY,
  login_notification BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);
