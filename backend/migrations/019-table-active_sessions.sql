-- Active sessions table for tracking user login sessions and activity

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', 'public', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';
SET default_table_access_method = heap;

CREATE TABLE IF NOT EXISTS active_sessions (
    id BIGSERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL UNIQUE,
    last_activity TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL
);

-- Index for quick lookups by admin_id
CREATE INDEX IF NOT EXISTS idx_active_sessions_admin_id ON active_sessions(admin_id);

-- Index for quick lookups by token_jti
CREATE INDEX IF NOT EXISTS idx_active_sessions_token_jti ON active_sessions(token_jti);

-- Index for finding inactive sessions
CREATE INDEX IF NOT EXISTS idx_active_sessions_last_activity ON active_sessions(last_activity);

-- Composite index for admin activity queries
CREATE INDEX IF NOT EXISTS idx_active_sessions_admin_last_activity ON active_sessions(admin_id, last_activity DESC);
