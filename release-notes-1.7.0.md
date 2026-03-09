# Release Notes — v1.7.0

## Settings Page Overhaul

### General Settings
- **Theme change now works immediately** — saving the theme in General settings applies it instantly without a page reload. The `themeOverride` in localStorage is synced when saving so the App.jsx theme propagation picks it up correctly.
- Removed unused "Validate" button from General tab actions.

### Telegram Bot Settings
- **All text fields are now clearable** — Default Chat ID and Notification Time each have a clear (×) button.
- **Message Template field added** — was previously in the backend state but missing from the UI. Now rendered as a textarea with a clear button.

### Database Settings
- **Help icons added** — `ⓘ` info icons with descriptive tooltips are placed above the Backup section and beside each Restore section label, explaining what each operation does.

### Control Panel
- **Certificate section** — loads domain/email/token from stored config when switching to the Control Panel tab (already worked via `fetchCert()`).
- **"Save & Install" button** — replaces the old "Issue" button. Clicking it opens a progress modal that:
  1. Saves the cert config (domain, email, Cloudflare API token) to the database.
  2. Writes `/root/.cloudflare.ini` for DNS-01 challenges.
  3. Runs `certbot certonly --dns-cloudflare` (falls back to `--standalone` HTTP-01 if DNS-01 fails).
  4. Writes an nginx config to `/etc/nginx/sites-available/cmp-<domain>.conf` with HTTPS redirect if a cert was issued, or HTTP-only if not.
  5. Restarts nginx.
  6. Refreshes cert status on success.
- **Remote Server Settings section removed** — entire section and its state removed from the Control Panel tab.

## Backend
- New route: `POST /api/admin/control/cert/install` — SSE endpoint that orchestrates the above cert install flow. Streams real-time progress to the frontend.

## Bug Fixes
- Fixed `currentForm` not falling back cleanly when no tab-specific form matched (was referencing removed `rsForm`).
- Fixed `onSave` and `onTest` key mapping that previously fell through to `'remoteServer'` for unrecognized tabs.
