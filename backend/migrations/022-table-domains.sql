-- Migration: Create domains table
-- Description: Stores domain-to-server mappings with service tiers and unlimited status

CREATE TABLE IF NOT EXISTS domains (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  server VARCHAR(50) NOT NULL,
  service VARCHAR(50) NOT NULL CHECK (service IN ('Basic', 'Premium')),
  unlimited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_domains_server ON domains(server);
CREATE INDEX IF NOT EXISTS idx_domains_service ON domains(service);
CREATE INDEX IF NOT EXISTS idx_domains_service_unlimited ON domains(service, unlimited);
CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);

-- Comment on table
COMMENT ON TABLE domains IS 'Domain to server mappings with service tier and unlimited status';
COMMENT ON COLUMN domains.id IS 'Auto-incrementing primary key';
COMMENT ON COLUMN domains.domain IS 'Domain name (e.g., example.com)';
COMMENT ON COLUMN domains.server IS 'Server name (e.g., SG01, HK02)';
COMMENT ON COLUMN domains.service IS 'Service tier: Basic or Premium';
COMMENT ON COLUMN domains.unlimited IS 'Whether this domain has unlimited service';
COMMENT ON COLUMN domains.created_at IS 'Timestamp when domain was added';
COMMENT ON COLUMN domains.updated_at IS 'Timestamp when domain was last updated';
