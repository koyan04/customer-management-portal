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
account_name, service_type, account_type, expire_date, total_devices, data_limit_gb, remark
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
