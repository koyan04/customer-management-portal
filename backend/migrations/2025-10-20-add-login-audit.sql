-- Create table to record admin login events
-- Safe to run multiple times
CREATE TABLE IF NOT EXISTS login_audit (
	id SERIAL PRIMARY KEY,
	admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
	role_at_login TEXT NOT NULL,
	ip TEXT,
	user_agent TEXT,
	location TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helpful indexes for querying recent activity per user
CREATE INDEX IF NOT EXISTS idx_login_audit_admin_id ON login_audit(admin_id);
CREATE INDEX IF NOT EXISTS idx_login_audit_created_at ON login_audit(created_at DESC);

