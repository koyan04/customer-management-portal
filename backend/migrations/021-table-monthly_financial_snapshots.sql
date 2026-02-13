-- Monthly Financial Snapshots
-- Stores monthly revenue calculations as read-only snapshots based on user counts and prices at month end
-- Once created, these snapshots are not affected by subsequent price or user data changes
-- Supports both global (ADMIN) and per-server (SERVER_ADMIN) snapshots via server_id column

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

CREATE TABLE IF NOT EXISTS monthly_financial_snapshots (
  id SERIAL PRIMARY KEY,
  month_start DATE NOT NULL,
  month_end DATE NOT NULL,
  server_id INT REFERENCES servers(id) ON DELETE CASCADE,
  
  -- User counts at end of month
  mini_count INT NOT NULL DEFAULT 0,
  basic_count INT NOT NULL DEFAULT 0,
  unlimited_count INT NOT NULL DEFAULT 0,
  
  -- Prices in cents at end of month
  price_mini_cents INT NOT NULL DEFAULT 0,
  price_basic_cents INT NOT NULL DEFAULT 0,
  price_unlimited_cents INT NOT NULL DEFAULT 0,
  
  -- Calculated revenue
  revenue_cents BIGINT NOT NULL DEFAULT 0,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  created_by INT REFERENCES admins(id) ON DELETE SET NULL,
  notes TEXT,
  
  CONSTRAINT month_start_format CHECK (month_start = date_trunc('month', month_start)::date)
);

-- Create unique constraint on (month_start, server_id) to allow one snapshot per month per server
-- NULL server_id for ADMIN global snapshots, non-NULL for SERVER_ADMIN per-server snapshots
CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_snapshots_month_server 
ON monthly_financial_snapshots(month_start, COALESCE(server_id, 0));

CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_server ON monthly_financial_snapshots(server_id);
CREATE INDEX IF NOT EXISTS idx_monthly_snapshots_month ON monthly_financial_snapshots(month_start DESC);

COMMENT ON TABLE monthly_financial_snapshots IS 'Stores monthly financial snapshots calculated at end of each month. These are permanent records not affected by subsequent data changes.';
COMMENT ON COLUMN monthly_financial_snapshots.month_start IS 'First day of the month (YYYY-MM-01)';
COMMENT ON COLUMN monthly_financial_snapshots.month_end IS 'Last day of the month';
COMMENT ON COLUMN monthly_financial_snapshots.server_id IS 'NULL for ADMIN global snapshots (all servers), or specific server_id for SERVER_ADMIN per-server snapshots';
COMMENT ON COLUMN monthly_financial_snapshots.revenue_cents IS 'Total revenue = (mini_count * price_mini_cents) + (basic_count * price_basic_cents) + (unlimited_count * price_unlimited_cents)';
COMMENT ON COLUMN monthly_financial_snapshots.notes IS 'Optional notes about price changes or other relevant information for this month';
