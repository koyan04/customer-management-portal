-- migration: add table for telegram bot expire audit
CREATE TABLE IF NOT EXISTS telegram_bot_expire_audit (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  months integer NOT NULL,
  actor text NULL,
  old_expire timestamptz NULL,
  new_expire timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
