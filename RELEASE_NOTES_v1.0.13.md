# v1.0.13 – 2025-11-11

## What changed

Migrations hotfix to repair fresh installs where a minimal `users` table from pre-bootstrap existed and the full schema did not backfill all columns. This manifested as:

```
Failed to seed users: column "expire_date" of relation "users" does not exist
```

Key updates:
- `backend/migrations.sql`: Added a reconciliation block that conditionally `ALTER TABLE users` to add any missing columns (`service_type`, `contact`, `expire_date`, `total_devices`, `data_limit_gb`, `remark`, `display_pos`).
- Ensures uniqueness on `(server_id, account_name)` via a unique index if the constraint is missing.
- Re-guards `users(server_id)` index creation idempotently.

## Impact
- Fresh VPS installs and mixed-state upgrades that previously created a minimal `users` table will now get the full set of columns during migrations.
- Fixes the seeding error for sample users.

## Upgrade notes
- If you already ran the installer and hit the error above, simply rerun migrations and then reseed users:
  1. Run migrations again (will be no-op for already applied parts, will add missing columns):
     - `node backend/run_migrations.js`
  2. Seed users again:
     - `node backend/seedUsers.js`
- Alternatively, re-run the installer one-liner pinned to `v1.0.13`; it is idempotent and will apply the new migration and seed data.

## Integrity
- No changes to the installer script in this release; only the migrations were updated.
