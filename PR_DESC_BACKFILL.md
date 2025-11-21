Title: Backfill pricing cents in settings_audit + validator + tests

Summary
-------
This branch adds a SQL migration and a Node backfill script to ensure historical `settings_audit.after_data` entries contain canonical integer-cent pricing keys (`price_mini_cents`, `price_basic_cents`, `price_unlimited_cents`). It also updates `validateSettings` to prefer cents fields when present and adds unit tests for the validator and the backfill script.

Files changed
-------------
- backend/migrations/2025-10-25-backfill-settings-audit-pricing.sql  (new)
- backend/scripts/backfill_pricing_audit.js  (new, exported main for testability)
- backend/lib/validateSettings.js  (updated to prefer *_cents)
- backend/tests/backfill_pricing_audit.test.js  (new tests with mocked DB)
- backend/tests/validateSettings.test.js  (updated with additional cents tests)
- backend/README.md  (notes)

Migration run checklist (recommended)
----------------------------------
1. Create a DB backup (dump or snapshot).
2. Run migrations (this will apply the SQL migration):

```powershell
cd backend
npm run migrate
```

3. Preview the audit backfill (dry-run):

```powershell
node backend\scripts\backfill_pricing_audit.js --dry-run --batch=200
```

4. If dry-run output looks good, run the backfill:

```powershell
node backend\scripts\backfill_pricing_audit.js --batch=200
```

5. Smoke test admin financial endpoint and confirm reports match expectations.

Notes
-----
- The Node script is idempotent for rows already containing cents keys. It favors `price_backup_decimal` if present, then legacy decimal keys, else 0.
- Tests mock the DB layer (`../db`) so they run hermetically in CI.
