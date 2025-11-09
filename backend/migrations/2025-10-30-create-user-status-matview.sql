-- Create a materialized view to speed up status-based queries (expired/soon/active)
-- This view is refreshed after bulk imports to provide fast reads for dashboards.

CREATE MATERIALIZED VIEW IF NOT EXISTS user_status_matview AS
SELECT
  u.id,
  u.server_id,
  u.account_name,
  u.service_type,
  u.contact,
  u.expire_date,
  u.total_devices,
  u.data_limit_gb,
  u.remark,
  s.server_name,
  s.ip_address,
  s.domain_name,
  CASE
    WHEN u.expire_date < now() THEN 'expired'
    WHEN u.expire_date >= now() AND u.expire_date <= now() + interval '24 hours' THEN 'soon'
    ELSE 'active'
  END AS status
FROM users u
JOIN servers s ON s.id = u.server_id;

-- Helpful indexes for fast filtering and ordering
CREATE INDEX IF NOT EXISTS user_status_matview_status_idx ON user_status_matview (status);
CREATE INDEX IF NOT EXISTS user_status_matview_expire_idx ON user_status_matview (expire_date);

-- Note: this materialized view must be refreshed after imports or other bulk changes:
-- REFRESH MATERIALIZED VIEW user_status_matview;
