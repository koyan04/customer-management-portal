-- Add server_id to monthly_financial_snapshots for per-server snapshots
-- NULL server_id means ADMIN global snapshot (all servers)
-- Non-NULL server_id means SERVER_ADMIN snapshot for specific server

-- Drop old unique constraint on month_start
ALTER TABLE monthly_financial_snapshots DROP CONSTRAINT IF EXISTS monthly_financial_snapshots_month_start_key;

-- Add server_id column (nullable)
ALTER TABLE monthly_financial_snapshots 
ADD COLUMN IF NOT EXISTS server_id INT REFERENCES servers(id) ON DELETE CASCADE;

-- Create unique constraint on (month_start, server_id) to allow one snapshot per month per server
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_snapshots_month_server 
ON monthly_financial_snapshots(month_start, COALESCE(server_id, 0));

-- Create index for querying by server
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_server ON monthly_financial_snapshots(server_id);

COMMENT ON COLUMN monthly_financial_snapshots.server_id IS 'NULL for ADMIN global snapshots (all servers), or specific server_id for SERVER_ADMIN per-server snapshots';
