-- Update user_status_matview cutoff: compute at next-day midnight (local)
-- Status groups: expired | soon | active

DROP MATERIALIZED VIEW IF EXISTS user_status_matview;

CREATE MATERIALIZED VIEW user_status_matview AS
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
    WHEN (u.expire_date::date + interval '1 day') <= now() THEN 'expired'
    WHEN (u.expire_date::date + interval '1 day') > now() AND (u.expire_date::date + interval '1 day') <= now() + interval '1 day' THEN 'soon'
    ELSE 'active'
  END AS status
FROM users u
JOIN servers s ON s.id = u.server_id;

-- Helpful indexes for fast filtering and ordering
CREATE INDEX IF NOT EXISTS user_status_matview_status_idx ON user_status_matview (status);
CREATE INDEX IF NOT EXISTS user_status_matview_expire_idx ON user_status_matview (expire_date);

-- Note: refresh this view after imports or bulk updates:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY user_status_matview;