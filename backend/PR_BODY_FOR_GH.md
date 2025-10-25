Backfill pricing cents in settings_audit + validator + tests

This PR adds a SQL migration and a Node backfill script to ensure historical `settings_audit.after_data` entries contain canonical integer-cent pricing keys (`price_mini_cents`, `price_basic_cents`, `price_unlimited_cents`). It also updates `validateSettings` to prefer cents fields when present and adds unit tests for the validator and the backfill script.

Files changed
- backend/migrations/2025-10-25-backfill-settings-audit-pricing.sql
- backend/scripts/backfill_pricing_audit.js
- backend/lib/validateSettings.js
- backend/tests/backfill_pricing_audit.test.js
- backend/tests/backfill_integration_pgmem.test.js (new integration test)
- backend/tests/validateSettings.test.js
- backend/README.md

Migration and run checklist (recommended)
1. Create a DB backup (dump/snapshot).
2. Run migrations: `npm run migrate` from `backend/`.
3. Preview backfill (dry-run):
   node backend\scripts\backfill_pricing_audit.js --dry-run --batch=200
4. If dry-run looks good, run the backfill:
   node backend\scripts\backfill_pricing_audit.js --batch=200
5. Smoke test Financial admin endpoint and verify reports.

Notes
- The backfill is idempotent and prefers `price_backup_decimal` if present, then legacy decimal keys, else 0.
- Tests mock `../db` so they are hermetic in CI.
