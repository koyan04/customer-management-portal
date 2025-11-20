-- migration: create table to store invalidated token JTIs
CREATE TABLE IF NOT EXISTS invalidated_tokens (
  id SERIAL PRIMARY KEY,
  jti TEXT NOT NULL UNIQUE,
  admin_id INTEGER NULL,
  reason TEXT NULL,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invalidated_tokens_jti ON invalidated_tokens(jti);
