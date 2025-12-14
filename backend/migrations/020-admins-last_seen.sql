-- Add last_seen column to admins table to track when users were last active
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITHOUT TIME ZONE;

-- Create index for querying by last_seen
CREATE INDEX IF NOT EXISTS idx_admins_last_seen ON admins(last_seen DESC);
