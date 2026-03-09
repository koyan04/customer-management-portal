# Release Notes — v1.6.0

## New Features

### GUI Update Manager (Settings → Update)
- **Version status cards**: current version, latest GitHub release, last updated timestamp, and up-to-date/outdated status — all visible at a glance in the Settings panel.
- **One-click update**: an Update button appears automatically when a newer release is available. Updates run fully unattended via a new backend script (`backend/scripts/update-unattended.sh`).
- **Real-time SSE progress modal**: update output streams line by line into an animated progress modal — no page refresh or SSH session needed.
- **Auto-check**: optional automatic version check on a configurable interval (default 24 h), persisted in `localStorage`.
- **New API routes**: `GET /control/update/version` (version comparison) and `POST /control/update/run` (SSE streaming update).

### `backend/scripts/update-unattended.sh`
- Fully non-interactive update script safe to run from the backend process.
- Fetches latest GitHub release tarball, backs up the database, preserves `.env` / logo / upload files, installs dependencies, runs all pending migrations, builds the frontend, and deploys it.
- Sends `RESTART_SIGNAL` on success so the backend can self-restart gracefully.

### JSON Generator Improvements
- **Configurable data limit**: new *Data Limit (GB)* input (default 150 GB) shown next to the Expire Date field; hidden automatically when the *Unlimited* checkbox is checked.
- **Optional .txt export**: new *Save TXT File* checkbox in Step 5. When unchecked, only the `.json` subscription file is saved — no extra `.txt` artifact.
- **Layout redesign**: Step 5 filename row split into two rows — row 1 = prefix/suffix inputs, row 2 = Save TXT checkbox + file preview. Top menu Unlim + LB checkboxes stacked vertically for clarity.

### Copy Menu Theme Support (Key Manager)
- Per-variant accent colors: Base64 → blue, SingBox → purple, V2Ray → orange, V2Box → teal.
- `km-ui-light` / `km-ui-dark` snapshot classes applied at render time, preventing `prefers-color-scheme` changes from altering copied link appearance.

## Bug Fixes & Improvements

- **SPA routing fix** (`backend/app.js`): static fallback now correctly serves `backend/public/index.html` instead of the stale `frontend/dist/index.html`, eliminating 404s on hard refresh.
- **Theme race condition** (`frontend/src/App.jsx`): `appTheme` is now initialised synchronously from `localStorage` on first render, preventing a brief flash of the wrong theme.
- **New route guard**: `AdminOrServerAdminRoute` component for pages that require `ADMIN` or `SERVER_ADMIN` role.

## Database / Migrations

All existing migration files (`000_schema.sql` through the latest) are applied automatically by `node run_migrations.js` during both fresh install and the new GUI update flow. No manual SQL changes required.

## Install / Update

### Fresh install
```bash
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.6.0/scripts/install.sh | sudo bash
```

### One-click GUI update (from v1.5.x)
Open the portal → **Settings → Update** → click **Check for Update** → click **Update**.

### Manual update on VPS
```bash
sudo bash /srv/cmp/backend/scripts/update-unattended.sh
```
