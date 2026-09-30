-- Table: login_lockouts
-- Purpose: persist per-account failed-login counts so an account lockout
-- survives a service restart and is shared across every source IP.
--
-- The per-IP throttle in backend/lib/authGuard.js is intentionally in-memory
-- (it only needs to reset on restart); this table covers the durable layer that
-- stops a slow distributed guessing attack.
--
-- lib/authGuard.js also runs CREATE TABLE IF NOT EXISTS at boot, so this
-- migration exists mainly to document the schema and to guarantee the table
-- exists on a completely fresh install before the first request arrives.

CREATE TABLE IF NOT EXISTS login_lockouts (
    username text PRIMARY KEY,
    failed_count integer NOT NULL DEFAULT 0,
    first_fail_at timestamp with time zone,
    last_fail_at timestamp with time zone,
    locked_until timestamp with time zone
);

-- Supports periodic cleanup of rows whose lock has already expired.
CREATE INDEX IF NOT EXISTS idx_login_lockouts_locked_until ON login_lockouts (locked_until);

COMMENT ON TABLE login_lockouts IS 'Failed-login tracking for admin accounts; locked_until is NULL when the account is not locked.';
