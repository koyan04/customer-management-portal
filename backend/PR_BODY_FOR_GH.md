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

Time zone setting
-----------------

This PR also adds a new "Time Zone" option under Settings > General. The server accepts a `timezone` field (either `null`/`auto` to use the client's browser time, or a valid IANA time zone string such as `America/New_York`). The backend validator (`backend/lib/validateSettings.js`) validates IANA identifiers using `Intl.DateTimeFormat` and stores the value in `app_settings.general.timezone`.

Client behavior:
- The frontend persists the selected timezone to `localStorage` under `app.timezone` so formatting takes effect immediately for the current browser session.
- Date/time displays across the UI are formatted using the app-selected timezone (when set) via a small helper `frontend/src/lib/timezone.js` which uses `Intl.DateTimeFormat` with the `timeZone` option.

Migration notes:
- This is non-destructive; if `timezone` is not present existing behavior (browser-local times) remains. Reviewers: please confirm the preferred default (we currently use `auto` to preserve browser-local formatting).

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
