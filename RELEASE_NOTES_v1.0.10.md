# Release Notes v1.0.10

Date: 2025-11-10

## Hotfix: Migration Failure on Fresh Installs
Some fresh VPS installs encountered `relation "users" does not exist` during the migration phase, aborting schema setup. Although `migrations.sql` includes a `CREATE TABLE IF NOT EXISTS users` early, race/mixed-state or tag checkout mismatches could allow downstream statements (indexes, DO blocks) to fire before the table existed.

### Fixes
- Added defensive pre-bootstrap in `backend/run_migrations.js` creating minimal `admins`, `servers`, and `users` tables before executing `migrations.sql`.
- Wrapped early `users` index creation in `migrations.sql` with a guarded `DO` block (checks `to_regclass('public.users')`).

### Outcome
Fresh installs no longer fail with missing `users` relation; the full schema (including additional columns and indexes) is reconciled idempotently by the main migration file.

### Upgrade Guidance
- For failed installs on v1.0.9: simply re-run the installer after pulling v1.0.10 (or run `node backend/run_migrations.js` on the host). No manual SQL required.
- Existing deployments are unaffected; changes are additive and idempotent.

```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.10/scripts/install.sh | bash"
```

### Files Changed
- `backend/run_migrations.js`
- `backend/migrations.sql`
- `CHANGELOG.md`
- `VERSION`
- `README.md`
- Added: `RELEASE_NOTES_v1.0.10.md`

### Verification Checklist
1. Run `node backend/run_migrations.js` — should print `Migrations applied successfully`.
2. Confirm `\d users` in psql shows expected columns (including `display_pos`, `service_type`).
3. Installer completes without schema errors on a clean server.

### Next Steps (Optional)
- Add migration logging of statement batches & timing for future diagnostics.
- Introduce a small test harness that spins up a fresh ephemeral DB and runs `run_migrations.js` in CI.

---
Hotfix delivered quickly to unblock fresh deployments.
