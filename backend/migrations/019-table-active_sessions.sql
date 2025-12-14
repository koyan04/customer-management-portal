-- Active sessions table for tracking user login sessions and activity
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
