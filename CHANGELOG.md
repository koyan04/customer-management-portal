# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0 – 2025-11-09

- Initial public release
  - Auto-detect materialized view support (exists + unique index) with optional env override
  - Quiet-by-default HTTP request logging; enable via `VERBOSE_HTTP_LOG=1`
  - Backend serves built frontend directly for simplified deployment
  - Added `backend/.env.example` and MIT `LICENSE`
  - Documentation: installation guide, security notes, upgrade notes
  - Admin matview widget with coalesced refresh and health visibility

## 1.0.1 – 2025-11-10

- Installer enhancement: auto-install Node.js 20.x LTS if missing (Debian/Ubuntu via NodeSource)
  - Set `CMP_SKIP_NODE_AUTO_INSTALL=1` to disable and require preinstalled Node
  - Improves first-time install experience on minimal servers

## 1.0.2 – 2025-11-10

- Add Debian/Ubuntu bootstrap script (`scripts/bootstrap.sh`) to install prerequisites automatically
  - New beginner-friendly one-liner in README points to the bootstrap
  - Keeps direct installer path for non-Debian distros

## 1.0.3 – 2025-11-10

- Fix bootstrap & installer interactive prompts when using piping
  - `bootstrap.sh` now downloads installer to a temp file instead of piping
  - `install.sh` reads prompts from /dev/tty (with fallback) and aborts with guidance if no TTY available
  - Prevents variables like ADMIN_USER being unset due to stdin consumed by script body

## 1.0.4 – 2025-11-10

- Fix installer migration failure: add base `users` table creation to migrations
  - Creates `users` with columns used by API/import/export flows (account_name, service_type, contact, expire_date, quotas, remark, display_pos, server_id)
  - Adds UNIQUE constraint on `(server_id, account_name)` and index on `server_id`
  - Keeps later additive migrations (display_pos backfill, service_type backfill) idempotent
- Add missing permission tables for fresh installs: `viewer_server_permissions`, `server_admin_permissions`
  - Aligns schema with routes and auth middleware checks

## 1.0.5 – 2025-11-10

- Harden migrations and installer to prevent "relation users does not exist" on fresh VPS installs
  - Wrap `display_pos` backfill and index creation in existence checks to avoid failing when `users` table isn't yet created by partial/legacy setups
  - Installer enhancements: optionally checkout a specific ref via `CMP_CHECKOUT_REF` or auto-checkout the latest tag; stop on migration errors

## 1.0.6 – 2025-11-10
## 1.0.7 – 2025-11-10
## 1.0.8 – 2025-11-10

- Optional Nginx reverse proxy provisioning in installer
  - Prompt (or set `CMP_ENABLE_NGINX=1`) to install and configure Nginx
  - Generates `/etc/nginx/sites-available/cmp-<domain>.conf` using Let's Encrypt certs and proxies to backend port
  - Enables site and reloads Nginx; includes HTTP->HTTPS redirect and ACME path

- Installer polish after successful real-world Cloudflare issuance
  - Adds Cloudflare token & zone preflight verification (informational, non-fatal)
  - Configurable DNS propagation wait via `CMP_DNS_PROPAGATION_SECONDS` (default 10)
  - Suppresses noisy Postgres "could not change directory to /root" by running psql from postgres home
  - Minor output wording improvements

- Installer refinements for smoother TLS issuance and post-install validation
  - Cloudflare credentials file is now always rewritten based on chosen auth mode (Token vs Global Key) to avoid mixed settings that cause 6003 errors
  - Detects and attempts to install the `dns-cloudflare` plugin (Debian/Ubuntu) if missing
  - Supports multiple certificate domains via `CMP_CERT_DOMAINS` (comma/space separated)
  - Optional HTTP-01 fallback (`CMP_CERT_HTTP_FALLBACK=1`) if DNS-01 fails
  - Skippable certificate step via `CMP_SKIP_CERT=1`
  - Adds a lightweight `/api/health` probe after services start

## 1.0.9 – 2025-11-10

- Security & robustness: automatic JWT secret generation during install
  - Installer now ensures `JWT_SECRET` exists in `backend/.env` even if the file already existed
  - Generates a 48-byte hex secret when missing or blank; preserves existing value if present
  - Prevents silent login/token verification failures caused by an unset secret on re-installs
- Startup diagnostics: backend now logs a clear warning if `JWT_SECRET` is missing
- Documentation: README updated to clarify JWT secret auto-generation behavior
- Integrity: updated installer SHA256 baseline

## 1.0.10 – 2025-11-10

- Fix: fresh install migration error `relation "users" does not exist`
  - Added a defensive pre-bootstrap in `run_migrations.js` to create `admins`, `servers`, and a minimal `users` table before applying `migrations.sql`
  - Guarded early `users` index creation in `migrations.sql` with a `DO $$ ... $$` block that checks `to_regclass('public.users')`
  - Result: installer now succeeds even on mixed-state or tag-mismatch scenarios where `users` might not yet exist when indexes are processed

## 2025-11-08

- Removed the entire "Frontend Dev Port" feature across backend and frontend:
  - Deleted backend admin endpoints for dev port status/control/restart and related audit paths
  - Removed frontend Settings UI, modal, progress bar, and persisted toast mechanics for restart flow
  - Simplified Vite config to static port (5173), deleted `frontend/devServer.config.json`
- Backend now serves the production frontend build directly:
  - `backend/app.js` serves `frontend/dist/` and includes SPA fallback for non-API routes
  - This enables a single systemd service to run the full app
- Installer improvements (`scripts/install.sh`):
  - Prompts for domain, email, backend port, and initial admin credentials
  - Supports Cloudflare auth via API Token (recommended) or Global API Key (new)
  - Issues certificate via certbot (DNS challenge) and configures a post-renew hook to restart backend
  - Seeds default admin, four sample servers, and five sample users per server on fresh installs
- Documentation:
  - Added repository `README.md` with installation, features, usage, and notes
  - Added sample Nginx reverse proxy configuration (see `deploy/nginx.sample.conf`)
  - Added example systemd worker unit for future async tasks (`backend/systemd/cmp-worker.service`)
- Tests:
  - Added integration test to verify the backend serves `index.html` from the built frontend
