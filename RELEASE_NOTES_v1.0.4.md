# Release Notes — v1.0.4

Date: 2025-11-10

## What’s Fixed

- Database migrations failed on fresh installs with “relation `users` does not exist.”
  - Added the base `users` table creation to `backend/migrations.sql` ahead of subsequent ALTERs and backfills.
  - Table includes: `id`, `server_id`, `account_name`, `service_type`, `contact`, `expire_date`, `total_devices`, `data_limit_gb`, `remark`, `display_pos`, `created_at`.
  - Constraints/Indexes: `UNIQUE(server_id, account_name)`, `INDEX(server_id)`.

## Upgrade Notes

- Fresh installs: run the installer as usual; migrations will now succeed end-to-end.
- Existing installs: no action needed unless you previously hit the migration error. Re-running the migration script is safe and idempotent.

## Integrity

- No changes to installer script content in this patch; the existing SHA256 baseline remains valid.
