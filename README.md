# Customer Management Portal

A full-stack portal for managing servers and their user accounts, with roles (Admin, Server Admin, Viewer), Telegram notifications, XLSX import/export, audit trails, and performance features like a materialized view for user status.

Current Version: `cmp ver 1.0.17`

Repository: https://github.com/koyan04/customer-management-portal.git

## Features

- Accounts and RBAC
  - Admins (global), Server Admins (per-server), and Viewers (read-only)
  - Avatar upload, password reset with audit
- Servers & Users
  - CRUD for servers
  - User XLSX template, import, export (per server)
  - Status filters (Active / Soon / Expired) with optional materialized view
  - Ordering servers (drag-and-drop) persisted in DB
  - Global user search (banner Search icon): partial account name match across accessible servers; actions: open server, extend expiry (+1 month for admins)
- Settings & Backups
  - General, Database, Telegram bot, Remote server, Certificate config
  - Config/DB snapshot backups and restores (merge-safe)
  - Audit trails for settings and sensitive actions
- Telegram Bot (optional)
  - Login notifications, health status endpoint
- Observability
  - Prometheus `/metrics`, basic health endpoint
- Production serving
  - Backend serves the built frontend (Vite) directly; single systemd service is enough
 - Materialized view status & control (Admin panel widget + endpoints)
   - Admin-only endpoints: `GET /api/admin/matviews` and `POST /api/admin/matviews/user_status_matview/refresh?mode=enqueue|now`
   - Coalesced refresh logic persists a `last_success` timestamp

## Quick Install (Linux)

Prerequisites: Ubuntu/Debian-like system with sudo/root, Node 18+, npm, PostgreSQL, certbot, and Cloudflare DNS credentials (API Token with Zone DNS Edit).

- Required packages
  - curl, tar, openssl, nodejs>=18, npm, postgresql, certbot, python3, python3-certbot-dns-cloudflare

Run the installer (as root):

```bash
# Debian/Ubuntu bootstrap: installs prerequisites, then runs the installer
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.17/scripts/bootstrap.sh | bash"
```

What the script does:
- Prompts for domain, Cloudflare API token, email, backend port, and an initial admin username/password
- Downloads and extracts the latest release tarball into `/srv/cmp`
- Installs backend and frontend dependencies and builds the frontend
- Writes backend `.env` with your inputs
- Ensures `JWT_SECRET` exists in `backend/.env` (auto-generates if missing)
- Creates DB user and database (best-effort), runs migrations
  - The migration runner includes a sequential fallback to recover if a batch fails unexpectedly
- Seeds admin, four sample servers, and five sample users per server
- Requests an initial certificate via certbot (Cloudflare DNS). You can include multiple hostnames via `CMP_CERT_DOMAINS` (comma/space separated). If DNS-01 fails, enable fallback with `CMP_CERT_HTTP_FALLBACK=1` to try HTTP-01. Propagation wait can be tuned via `CMP_DNS_PROPAGATION_SECONDS` (default 10). Optionally set up Nginx to terminate HTTPS (prompted; set `CMP_ENABLE_NGINX=1` to auto-enable).
- Creates and enables `cmp-backend.service` (and `cmp-telegram-bot.service` if present)
- Ensures a post-renew hook restarts the backend after certificate renewal

After install:

```bash
# Check service status
systemctl status cmp-backend.service
# (optional) Telegram bot
systemctl status cmp-telegram-bot.service
```

Visit the app:
- https://YOUR_DOMAIN
- Default backend port for direct access (if not behind TLS yet): http://YOUR_SERVER_IP:3001

Login:
- Use the admin credentials you provided during install

## Quick Install (Windows)

This repository includes a helper PowerShell script to assist with common Windows installation tasks. The script attempts to:

- Ensure Node.js is present (tries `winget` / `choco` if available).
- Downloads and extracts the release into an installation directory.
- Install backend/frontend dependencies and build the frontend.
- Start backend processes via `pm2` and optionally register Windows services using `nssm` (if present).

Important notes and limitations:

Note about release selection: both installers (the Linux `scripts/install.sh` and the Windows `scripts/install-windows.ps1` helper) prefer to download the latest semantic-release tag when available (for example `v1.2.3` or `1.2.3`) and intentionally avoid common prerelease tags like `-rc`, `-beta`, or `-alpha`. To force a specific ref, set `CMP_CHECKOUT_REF` for the Linux installer or pass `-CheckoutRef <ref>` to the PowerShell helper.

- The Windows helper does not attempt to install PostgreSQL or perform full TLS automation. Installing Postgres on Windows is environment-specific; for production we recommend using a managed database or installing Postgres separately.
- For TLS on Windows consider using win-acme (https://www.win-acme.com/) to obtain Let's Encrypt certificates, or use Cloudflare Origin Certificates combined with a reverse proxy (IIS, Nginx, Caddy) that terminates TLS.
- The helper is provided at `scripts/install-windows.ps1`. Run it as Administrator. It will try to install `pm2` and (optionally) `nssm` to register services. If `nssm` is not available, the script leaves PM2 running and prints instructions to register services manually.

Example (run as Administrator PowerShell):

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\scripts\install-windows.ps1 -InstallDir C:\srv\cmp -RepoUrl https://github.com/koyan04/customer-management-portal.git
```

After running the helper:

- Edit `backend/.env` with your PostgreSQL connection details and secrets.
- From `backend/` run migrations: `node run_migrations.js`.
- Seed the admin and sample data (optional):

```powershell
$env:SEED_ADMIN_USERNAME='admin'; $env:SEED_ADMIN_PASSWORD='admin123'; node seedAdmin.js
node seedServers.js
node seedUsers.js
```

If you need a fully automated Windows production installer (installing Postgres, configuring TLS and DNS automatically), open an issue or request and we can add an expanded `install-windows.ps1` that bundles or orchestrates those platform-specific installers.

Windows manual guide
--------------------
We provide a hands-on Windows installation guide at `WINDOWS_INSTALL.md`. It describes a safe, manual installation flow (recommended for production on Windows), covering prerequisites, PostgreSQL installation, building the frontend, configuring `.env`, running migrations, seeding, TLS options (win-acme/Cloudflare origin certs), and service registration via PM2/NSSM.
The included `scripts/install-windows.ps1` remains an optional helper for semi-automated runs, but for production we recommend following the manual guide.

### Windows: PostgreSQL automation

The new Windows installer helper supports automating PostgreSQL installation and provisioning. Use the `-InstallPostgres` flag and provide DB credentials when invoking `scripts/install-windows.ps1`.

Example (run as Administrator PowerShell):

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\scripts\install-windows.ps1 -InstallDir C:\srv\cmp -InstallPostgres -DBName cmp -DBUser cmp -DBPassword changeme -PostgresSuperPassword yourPostgresSuperPassword
```

What the installer will try to do when `-InstallPostgres` is provided:

- Attempt to install PostgreSQL via `winget` or `choco` (best-effort).
- Wait for the `psql` client to be available.
- Use the provided `PostgresSuperPassword` to run `psql` commands as `postgres` superuser to create the desired DB and DB user and grant privileges.
- Populate `backend/.env` with DB connection settings and run migrations (`node run_migrations.js`).

Notes and caveats:

- Automatic installation uses platform package managers and may vary by Windows version. If the script cannot install PostgreSQL automatically, it prints instructions to install it manually and re-run the provisioning steps.
- The script expects you to supply the `postgres` superuser password; some installers prompt for it during installation. If you cannot provide it, create the database and user manually and then run migrations.
- For production deployments on Windows, we still recommend using a managed PostgreSQL service where possible.

#### What the script does to install PostgreSQL

- Attempts to install PostgreSQL using `winget` with several common package IDs (best-effort).
- If `winget` is not available or fails, attempts to use Chocolatey (`choco install postgresql`).
- If both package managers are unavailable or the install fails, the script attempts to download the EnterpriseDB installer (default PostgreSQL 15.4; override with `PG_VERSION` env var) and run it in unattended mode using the provided `-PostgresSuperPassword` value.

Caveats:

- The EnterpriseDB installer and silent/unattended arguments differ across versions; the script uses commonly supported `--mode unattended --unattendedmodeui none --superpassword <pw>` flags, but if a particular Windows build or installer version requires different flags the unattended install may fail and you'll have to install PostgreSQL manually.
- The script waits up to 2 minutes for `psql` to appear in PATH after install; in some environments you may need to add the PostgreSQL bin directory to PATH or re-open PowerShell.
- If unattended install isn't possible in your environment, install PostgreSQL manually and re-run the script with `-InstallPostgres` omitted; then set `backend/.env` DB_* values and run migrations manually.

## Manual Install (advanced)

If you prefer manual steps:
1. Download and extract the latest release tarball to `/srv/cmp`
2. Install dependencies under `backend/` and `frontend/`
3. Build the frontend (`npm run build` in `frontend/`)
4. Create `backend/.env` with DB and secrets (see template below)
5. Run migrations and seed admin/servers/users
6. Create a systemd service for the backend (template below)
7. Issue a certificate with certbot (Cloudflare DNS) and ensure renew hooks restart the backend

### Sample `backend/.env`

```
PORT=3001
DOMAIN_NAME=example.com
LETSENCRYPT_EMAIL=you@example.com
CLOUDFLARE_API_TOKEN=cf_api_token_here
START_TELEGRAM_BOT=true
JWT_SECRET=replace_me
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=cmp
DB_USER=cmp
DB_PASSWORD=changeme
```

### Seed and migrate

```bash
cd /srv/cmp/backend
node run_migrations.js
SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin123 node seedAdmin.js
node seedServers.js
node seedUsers.js
```

### Systemd unit (backend)

```
[Unit]
Description=CMP Backend Service
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/srv/cmp/backend
Environment=NODE_ENV=production
EnvironmentFile=/srv/cmp/backend/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5s
User=root
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## How to use

- Settings → General: set site name, logo, favicon, timezone
- Servers: add/edit servers; reorder via the list toolbar’s Reorder button
- Users: per server, import/export XLSX, edit users, filter by status
- Accounts: manage admins/server-admins/viewers, set server permissions
- Telegram: set bot token and enable/disable; health available at `/internal/bot/status`
- Backups: download config/db snapshots; restore by uploading

## SSL and Cloudflare

- During install, you’ll be prompted for domain, email, and a Cloudflare API Token (recommended). The installer writes `/root/.cloudflare.ini` securely and runs `certbot certonly` with the DNS challenge.
- Renewal: Certbot’s timer typically handles renewals; a post-renew hook restarts the backend to pick up new certs.

## Reverse proxy (optional)

You can place Nginx in front of the backend for TLS termination and proxying. A ready-to-edit example is provided in `deploy/nginx.sample.conf`.

Steps:
- Copy the file to your Nginx sites-available and symlink to sites-enabled
- Replace `example.com` with your domain and adjust certificate paths if needed
- Reload Nginx

This sample proxies both `/` and `/uploads/` to the backend on `127.0.0.1:3001` and redirects HTTP to HTTPS.

## Verifying installer integrity

If you download `scripts/install.sh` to disk before executing, compute its SHA256 and verify it. The installer can also self-verify when `CMP_INSTALL_EXPECTED_SHA256` is provided.

Example:

```bash
# Download and verify
curl -fsSL -o install.sh https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.17/scripts/install.sh
sha256sum install.sh
export CMP_INSTALL_EXPECTED_SHA256=<paste-the-sha256>
sudo bash install.sh
```

Note: For security, prefer downloading to a file, verifying, then executing instead of piping directly to `bash`.

## Development

- Frontend dev server runs at port 5173 locally (`npm run dev` in `frontend/`)
- Backend runs at port 3001 by default (`node backend/index.js`)
- The backend serves the built frontend in production from `frontend/dist`
 - Tests (frontend): Vitest collects only project `*.test|*.spec` files; library test files are excluded for speed

Note: On non-Debian systems, install prerequisites (curl, tar, openssl, python3, postgresql, certbot, python3-certbot-dns-cloudflare) and then run the installer directly:

```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.17/scripts/install.sh | bash"
```

## Security considerations

Keep production secure by default:

- Secrets: set a strong `JWT_SECRET` (at least 32 random bytes) and don’t commit `.env`. Rotate if leaked.
- HTTPS: terminate TLS at Nginx or let the backend serve with valid certs; avoid plain HTTP on the internet.
- Cloudflare token: prefer a scoped API Token with Zone.DNS Edit for a single zone, not a Global API Key.
- CORS/headers: in production, restrict origins to your domain; set `X-Forwarded-*` correctly behind proxies.
- Rate limiting: consider enabling a reverse-proxy rate limit on `/api/auth/login` and admin endpoints.
- Logs: disable verbose HTTP logs in prod (default). Avoid logging PII; rotate logs with logrotate.
- Admin bootstrap: change seeded admin credentials immediately; create additional admins and remove defaults.
- Database: enforce least-privilege DB user; ensure regular backups and offsite snapshots.

### Integrity-pinned installer (optional)

You can pin and verify the installer script:

```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.17/scripts/install.sh
sha256sum install.sh
# Optionally export expected hash then run
export CMP_INSTALL_EXPECTED_SHA256=<paste-output-sha>
sudo bash install.sh
```

Set `CMP_SKIP_NODE_AUTO_INSTALL=1` before running if you want to require a preinstalled Node instead of auto-install.

## Upgrade notes (pre-1.0 → 1.0.0)

- Materialized view flag is now auto-detected (presence + unique index); env override remains as `USE_USER_STATUS_MATVIEW`.
- Verbose request logs are off by default; enable temporarily with `VERBOSE_HTTP_LOG=1` for troubleshooting.
- Backend serves the built frontend from `frontend/dist`; most deployments need only a single systemd service.
- Dev convenience endpoints and the “Frontend Dev Port” feature were removed; Vite dev port is now fixed (5173).
- New `backend/.env.example` provided; MIT `LICENSE` added.

## Contributing & Security

- See `CONTRIBUTING.md` for guidelines on PRs and development workflow.
- See `SECURITY.md` to report vulnerabilities privately (responsible disclosure).

## CI

This repository includes a GitHub Actions workflow at `.github/workflows/ci.yml` that:
- Computes and summarizes the SHA256 of `scripts/install.sh` and optionally enforces a baseline (`scripts/install.sha256.baseline`).
- Installs dependencies for frontend and backend; builds the frontend.
- Runs the backend test suite.

To update the baseline hash intentionally (when changing `install.sh`):
1. Open a PR that updates both `scripts/install.sh` and `scripts/install.sha256.baseline` (the latter contains the expected hash line).
2. The CI will compare the two; mismatches will fail the check.

## Ops additions

New helper services and timers are included under `backend/systemd/`:
- Certificate expiry checker (`cmp-cert-expiry.service` + `.timer`) using `backend/scripts/check_cert_expiry.js`
- Background worker (`cmp-worker.service`) running `backend/scripts/worker.js`
- Optional periodic matview refresh trigger (`cmp-matview-refresh.service` + `.timer`)
- Certificate expiry alerts: `check_cert_expiry.js` supports Slack and Telegram notifications.

### Cert expiry alert configuration

Provide flags or environment variables for notifications when using the systemd service:

Flags:
```
node scripts/check_cert_expiry.js example.com --warn=30 --critical=10 \
  --slack-webhook=https://hooks.slack.com/services/XXX/YYY/ZZZ \
  --telegram-bot-token=123456:ABCDEF --telegram-chat-id=987654321
```

Environment variables (preferred for systemd units):
```
CERT_EXPIRY_WARN_DAYS=30
CERT_EXPIRY_CRITICAL_DAYS=10
CERT_EXPIRY_SLACK_WEBHOOK=https://hooks.slack.com/services/XXX/YYY/ZZZ
CERT_EXPIRY_TELEGRAM_BOT_TOKEN=123456:ABCDEF
CERT_EXPIRY_TELEGRAM_CHAT_ID=987654321
```
Exit codes: 0 ok, 1 warn threshold crossed, 2 critical.

Enable timers (on server):
```bash
sudo cp backend/systemd/cmp-*.service backend/systemd/cmp-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cmp-cert-expiry.timer
sudo systemctl enable --now cmp-matview-refresh.timer
```

### Tests & Teardown

The backend test suite uses Jest (`npm test` in `backend/`). A global teardown (`tests/jest.teardown.js`) ensures:

- `prom-client` metrics collectors are cleared to avoid interval leaks.
- The PostgreSQL pool is closed via `pool.shutdown()`.
- Active timers are `unref()`'d so Jest can exit cleanly.

If you add long-running intervals or background workers in tests, ensure they are either:
- Scoped to the test file and cleared in `afterAll`, or
- Marked with `.unref()` so they don't hold the event loop open.

To debug lingering handles:
```bash
cd backend
npx jest --detectOpenHandles --runInBand
```
The teardown prints a summary of remaining handle types for quick triage.

### Operational Hardening (Next Steps)

Potential follow-ups you can implement to further harden production:
- CI hash verification of `scripts/install.sh` (ensure integrity in PRs).
- Periodic certificate expiry check (cron) with alert before renewal window.
- Activate the sample worker systemd unit for async jobs (queue processing, scheduled tasks).
- Add structured logging (JSON) and a log rotation policy (logrotate config).
- Implement health probe endpoints for readiness/liveness (`/internal/ready`, `/internal/live`).
- Configure a matview refresh cron if using the user status materialized view in production.

## Versioning

The application exposes a human-friendly version string read from the root `VERSION` file.

- File path: `./VERSION`
- Format: free-form string (current: `cmp ver 1.0`). Recommend incrementing minor/patch numbers per release (e.g., `cmp ver 1.1`, `cmp ver 1.2`).
- Backend: included in `GET /api/health` response as `versions.appVersion`.
- Frontend: rendered in the footer when available.

To update:
1. Edit `VERSION` and replace its content with the new string.
2. Commit and deploy; backend reads at startup, no additional build step required.
3. (Optional) Tag the commit in git for traceability.

Example release bump:
```
echo "cmp ver 1.1" > VERSION
git add VERSION
git commit -m "Release: cmp ver 1.1"
git tag -a v1.1 -m "cmp ver 1.1"
git push --follow-tags
```

Clients querying `/api/health` will see:
```json
{
  "ok": true,
  "versions": {
    "gitSha": "abc1234",
    "buildTimestamp": null,
    "appVersion": "cmp ver 1.1"
  }
}
```

## Repository

- Issues and contributions welcome via: https://github.com/koyan04/customer-management-portal

## Release notes (quick)

- Release: cmp ver 1.0.17 (latest)
  - Hotfix: The bootstrap installer script (`bootstrap.sh`) was simplified to prevent it from downloading the wrong (older) version of the main installer. This resolves the issue where the installer would incorrectly prompt for GitHub credentials.

- Release: cmp ver 1.0.16
  - Fix: The installer now downloads a release tarball instead of using `git clone` to avoid credential prompts on public repositories.

- Release: cmp ver 1.0.15
  - Fix: Resolved a 500 Internal Server Error on the `GET /api/servers` endpoint caused by missing database columns.
  - Feat: Enhanced the migration runner to automatically apply all individual SQL migration files.
  - Feat: Added a script to seed safe, non-sensitive default application settings on new installations.
  - Security: Removed committed secrets and user-uploaded files from the repository history.
  - Security: Hardened `.gitignore` to prevent future commits of sensitive data.

- Release: cmp ver 1.0.14
  - New: Windows hands-on installation guide (`WINDOWS_INSTALL.md`) with step-by-step manual instructions for installing on Windows and production guidance.
  - New: Optional Windows helper scripts in `scripts/`: `install-windows.ps1` (semi-automated helper), `WINDOWS_QUICKCHECK.ps1` (post-install verification), and `WINDOWS_FIX_PG_PATH.ps1` (Postgres PATH quick-fix).
  - Improved: Windows installer attempts (best-effort) for PostgreSQL via `winget`/`choco` and EnterpriseDB fallback; documented caveats in README and `WINDOWS_INSTALL.md`.
  - Docs: README updated to point to the Windows guide and to describe optional helpers and recommended manual flow for production on Windows.

## Production checklist

Follow this checklist before exposing the application to production traffic. These are minimal hardening steps and operational runbook items:

1. Secrets and credentials
  - Replace any seeded/default admin passwords immediately. Do not use seeded credentials in production.
  - Set a strong `JWT_SECRET` (at least 32 random bytes) in `backend/.env`.
  - Store `backend/.env` and any Cloudflare API tokens securely (vault or OS key store). Do not commit secrets to git.

2. Database
  - Use a managed PostgreSQL service where possible, or run PostgreSQL on a hardened host with backups.
  - Ensure automated daily backups and periodic offsite snapshots. Test restore procedures in staging.
  - Use least-privilege DB user for the app (create a dedicated DB user rather than superuser).

3. TLS and certificates
  - Use certbot (Linux) or win-acme (Windows) for Let's Encrypt certs, or Cloudflare Origin Certificates behind a proxy.
  - Configure auto-renewal and a post-renew hook that restarts the backend to pick up new certificates.

4. Services and autorun
  - On Linux: enable systemd units (`cmp-backend.service`, `cmp-telegram-bot.service`) and confirm they start on boot.
  - On Windows: prefer PM2+pm2-windows-service or NSSM to run the backend as a service. Confirm services restart after reboot.

5. Observability & health
  - Enable Prometheus scraping of `/metrics` and add basic alerting for critical conditions (backend down, job failures, cert expiry).
  - Add liveness/readiness probes for any orchestrator and configure monitoring for service restarts.

6. Logging & rotation
  - Configure logrotate (Linux) or Windows log rotation for backend logs. Avoid verbose logs in production.
  - Ensure audit trails and settings_audit are archived as needed.

7. Access control & network
  - Restrict access to the admin UI by IP or VPN where possible.
  - Use firewall rules to limit DB access to only the application server or managed DB network.

8. Backups & restore drill
  - Regularly test DB and config snapshot restores. Ensure backups include `app_settings` and important configuration.

9. CI & installer integrity
  - Use the provided CI check to validate `scripts/install.sh` integrity (SHA256 baseline) if you rely on the automated installer.

10. First-run & onboarding
  - Generate and store initial admin credentials securely. Force password change on first login for seeded accounts.
  - Document runbook steps to rotate secrets, restore backups, and perform emergency access.

Follow-up improvements you may want to adopt later:
- Integrate structured logging and centralized log shipping (ELK/Graylog/Cloud provider). 
- Harden the installer with integrity checks and signed release artifacts.
- Add optional role-based access review and MFA enforcement for admin accounts.

On-call checklist
-----------------
We also provide a short on-call checklist for immediate incident triage: `OPERATOR_ONCALL_CHECKLIST.md`. Use it for fast triage and recovery steps (restart service, check DB, restore backup, cert renewals, rollback, contacts).
