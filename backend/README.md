# Backend — migrations & seeding

This folder contains the Express backend and migration helpers.

Quick steps to run migrations and seed the initial admin (PowerShell):

1. Make sure your Postgres env variables are set in the PowerShell session (or in a .env file read by dotenv):

```powershell
$env:DB_HOST = 'localhost'
$env:DB_PORT = '5432'
$env:DB_USER = 'your_db_user'
$env:DB_DATABASE = 'your_db_name'
$env:DB_PASSWORD = 'your_db_password' # optional if using .pgpass or other auth
```

2. Run the SQL migrations (from the repo root):

```powershell
# from repository root
cd backend; npm run migrate
```

3. Verify migrations (optional):

```powershell
cd backend; npm run check-migrations
```

4. Seed the initial admin account:

```powershell
# from backend/
node seedAdmin.js
```

Notes:
- The `migrate` npm script executes the `psql` command using PowerShell so environment variables (e.g. $env:DB_HOST) are interpolated correctly. If you prefer, run psql directly from your shell instead of the npm script.
- Ensure `psql` is installed and available on your PATH.

## XLSX import/export endpoints

The Users API exposes authenticated XLSX helpers for each server. All endpoints require a Bearer token in the `Authorization` header unless noted.

- Download template (header-only sheet):
	- GET `/api/users/server/:serverId/template.xlsx`
	- Alias: GET `/api/users/server/:serverId/template`
- Export users for a server:
	- GET `/api/users/server/:serverId/export.xlsx`
	- Alias: GET `/api/users/server/:serverId/export`
- Import users for a server (multipart form):
	- POST `/api/users/server/:serverId/import.xlsx` (field name: `file`)
	- Alias: POST `/api/users/server/:serverId/import`

Required request header for protected routes:

```
Authorization: Bearer <JWT>
```

### Import template format

Columns allowed (unknown columns are rejected). Note: `id` and `server_id` are system-managed and should be omitted (if present in a file, they will be ignored):

```
account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark
```

Required column: `account_name`

Type notes:
- `expire_date`: ISO-like string (e.g., `YYYY-MM-DD`).
- `total_devices`, `data_limit_gb`: numbers.

Import behavior:
- Upsert by `account_name` within the target server: existing users are updated, otherwise new users are inserted.
- Any provided `id` or `server_id` columns are ignored.

### Quick probe script

Use the included probe to check status codes/content types for these endpoints:

```
node scripts/probe_xlsx.js <serverId> [tokenFile]
```

- `serverId`: numeric server id (e.g., `7`).
- `tokenFile` (optional): path to a file containing a JWT (the last non-empty, dot-separated line is used). Defaults to `../temp_token.txt`.

Example (PowerShell):

```powershell
cd backend
# Optional: generate a dev token
node temp_gen_token.js > temp_token2.txt
# Probe endpoints for server 7
node scripts/probe_xlsx.js 7 temp_token2.txt
```

Expected:
- Without auth: 401/403
- With auth: 200 and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for `template`/`export`

## Backfill notes

We recently added canonical integer-cent pricing keys (`price_*_cents`) to the `app_settings.general` JSON and need to ensure historical `settings_audit.after_data` entries also include these keys so reports that read audit rows can compute historical revenue correctly.

- A SQL migration `backend/migrations/2025-10-25-backfill-settings-audit-pricing.sql` is provided to run as part of your normal migrations. It will iterate `settings_audit` rows for `settings_key = 'general'` and add `price_mini_cents`, `price_basic_cents` and `price_unlimited_cents` where missing.

- A helper Node script `backend/scripts/backfill_pricing_audit.js` is also included. It supports a dry-run mode and batching and can be used to preview or run the backfill from a trusted environment. Example:

```powershell
# Dry-run (preview changes):
node backend\scripts\backfill_pricing_audit.js --dry-run --batch=200

# Execute actual updates:
node backend\scripts\backfill_pricing_audit.js --batch=200
```

Run migrations and the script on a staging DB first and always take a DB backup before running on production.

## User status materialized view & feature flag

The API exposes user status (active / soon / expired) in several places. A materialized view `user_status_matview` can speed up `/api/users/by-status/:status` queries, especially when the user table grows large or many concurrent viewers are filtering by status.

### Cutoff semantics

Status classification uses an end-of-day cutoff: for a stored `expire_date` (date-only), the effective expiration moment is the start of the next local day (`expire_date + 1 day` at `00:00`).

```
cutoff = (expire_date::date + interval '1 day') at 00:00 local
Expired: now() >= cutoff
Soon:    now() < cutoff <= now() + 24h
Active:  cutoff > now() + 24h
```

### Enabling / disabling matview usage

Runtime usage is primarily auto‑detected now. The backend inspects whether the matview exists and whether the unique index (`user_status_matview_id_unique_idx`) is present (required for concurrent refresh). You can still override behavior with `USE_USER_STATUS_MATVIEW`:

| Env value | Mode | Result |
|-----------|------|--------|
| unset / empty | auto | Enabled only if matview exists AND unique index present (recommended) |
| `true` / `1` / `yes` / `on` | forced-on | Enabled if matview exists (warns if missing) |
| `false` / `0` / `no` / `off` | forced-off | Always disabled (falls back to live queries) |

Examples:
```
# Preferred: auto detect (leave unset)
# USE_USER_STATUS_MATVIEW=

# Force enable (still requires matview to exist)
USE_USER_STATUS_MATVIEW=true

# Force disable
USE_USER_STATUS_MATVIEW=false
```

Verbose HTTP request logging (those JSON lines like `early-req`, `incoming`, `req`) is now disabled by default. To temporarily enable them for troubleshooting set:
```
VERBOSE_HTTP_LOG=1
```

### Recommended defaults by environment

| Environment | Recommended | Rationale |
|-------------|-------------|-----------|
| Development | false       | Simpler to see immediate changes; avoids needing matview refreshes. |
| Staging     | true (after migration applied) | Exercise production-like performance path. |
| Production  | true        | Lower latency for by-status queries and reduced load. |

### Creating / refreshing the matview

Migrations create / update the matview (see `2025-11-06-update-user-status-matview-cutoff.sql`). To manually refresh:

```
-- Standard (blocking) refresh
REFRESH MATERIALIZED VIEW user_status_matview;

-- Concurrent (requires unique index on rows, migration adds this)
REFRESH MATERIALIZED VIEW CONCURRENTLY user_status_matview;
```

The backend also has a lightweight coalescing refresher in `lib/matview_refresh.js`; certain write paths enqueue a refresh. You can manually enqueue via admin endpoint:

```
POST /api/users/admin/refresh-user-status
Authorization: Bearer <ADMIN JWT>
```

### Frontend indicator

`GET /api/servers/summary` now returns a `features.useUserStatusMatview` flag. The Dashboard shows a small admin-only badge: `Matview: ON|OFF` for rollout visibility.

### Rollout checklist

1. Deploy migrations that (re)create the matview with cutoff semantics.
2. Run an initial `REFRESH MATERIALIZED VIEW user_status_matview;` (or CONCURRENTLY if index present).
3. Set `USE_USER_STATUS_MATVIEW=true` in staging; verify `/api/users/by-status/soon` etc. behave correctly.
4. Promote to production and set the env var. Monitor query plans / latency.
5. (Optional) Turn off temporarily by unsetting / setting to `false` if investigating live-table discrepancies.

### Troubleshooting

| Symptom | Possible Cause | Action |
|---------|----------------|--------|
| `/by-status` still slow | Flag disabled | Set `USE_USER_STATUS_MATVIEW=true` and restart. |
| Empty results with flag on | Matview stale / not refreshed | Run a manual refresh or enqueue via admin endpoint. |
| ERROR: cannot refresh concurrently | Missing unique index | Ensure the unique index migration ran, then retry with standard refresh or add the index. |
| Counts mismatch vs. Dashboard | Stale matview | Trigger refresh; confirm timestamps in DB. |
| Matview badge OFF unexpectedly | Unique index missing or matview not created | Apply matview migrations; ensure `user_status_matview_id_unique_idx` exists. |
| Forced-on but badge still OFF | Matview missing | Re-run migrations; check `to_regclass('public.user_status_matview')`. |

## Systemd units and timers (ops)

Sample units are provided in `backend/systemd/`:

- `cmp-backend.service`: main API/UI server.
- `cmp-telegram-bot.service`: optional Telegram bot process.
- `cmp-worker.service`: background worker (`backend/scripts/worker.js`).
- `cmp-cert-expiry.service` + `cmp-cert-expiry.timer`: daily certificate expiry check using `scripts/check_cert_expiry.js`.
- `cmp-matview-refresh.service` + `cmp-matview-refresh.timer`: periodic trigger to refresh the user-status matview.

Enable timers after copying to systemd:

```bash
sudo cp backend/systemd/cmp-*.service backend/systemd/cmp-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cmp-cert-expiry.timer
sudo systemctl enable --now cmp-matview-refresh.timer
```

## Admin control: update origin endpoints

The update origin (git remote URL) is persisted to the database and can be managed via admin endpoints. The server will always persist the provided URL even if the underlying `git` command fails, so the value is not lost across reloads.

- PUT `/api/admin/control/update/source`
	- Body: `{ url: string }`
	- Behavior: attempts `git remote set-url origin <url>` and persists `{ originUrl: url }` to `app_settings` under key `update`.
	- Responses:
		- 200 OK: git remote successfully updated and value persisted
		- 207 Multi-Status: value persisted but git remote update failed; response includes `{ gitError: string }`

- GET `/api/admin/control/update/source`
	- Returns `{ originUrl }` using `git remote get-url origin` when available; falls back to the stored DB value.

- GET `/api/admin/control/update/status`
	- Returns a lightweight status object to compare origins and trace changes:
		- `{ ok: true, gitOrigin: string|null, storedOrigin: string|null, updatedBy: number|null, updatedAt: string|null }`
	- `updatedBy` and `updatedAt` reflect the last admin and timestamp that changed the stored origin.

These endpoints are used by the Control Panel to show both Git and stored origins inline, surface partial-failure messages when git operations fail, and provide a "Retry git remote update" action that re-attempts updating the remote from the stored origin.

