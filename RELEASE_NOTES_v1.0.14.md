# v1.0.14 – 2025-11-11

## Summary
DO-free migrations hotfix resolving `syntax error at or near "DO"` encountered during batch and sequential migration modes on some fresh installs.

## Root Cause
A malformed injection of PL/pgSQL DO blocks appeared before the closing parenthesis of the `servers` table and additional DO blocks relied on procedural execution. Some environments or statement splitting logic failed to treat these blocks as standalone statements, producing syntax errors at `DO`.

## Changes
- Closed the `servers` table definition properly.
- Replaced all reconciliation DO blocks with idempotent SQL:
  - `ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS ...` (service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos)
  - Idempotent index creations (`users_server_account_unique_idx`, `users_server_id_idx`, `users_display_pos_idx`).
- Simplified display position migration (adds column + index only; skips row_number backfill for now—non-critical for baseline functionality).
- Removed legacy `service_type` backfill DO block (safe omission for fresh installs; legacy upgrades can backfill manually if needed).

## Impact
- Migrations now succeed without reliance on PL/pgSQL blocks, increasing portability and reducing parser edge cases.
- Fresh installs proceed cleanly; seeding phases no longer blocked by DO syntax errors.

## Upgrade Path
If you failed previously with `syntax error at or near "DO"`:
1. Pull tag `v1.0.14`.
2. Run migrations again: `node backend/run_migrations.js`.
3. Rerun seeding scripts if needed: `node backend/seedUsers.js`.

## Manual Backfill (Optional)
If you previously used `account_type` and want to populate `service_type`:
```sql
UPDATE users SET service_type = account_type WHERE service_type IS NULL AND account_type IS NOT NULL;
```

## Integrity
Installer script unchanged since v1.0.12 except version reference; only migrations and docs updated.
