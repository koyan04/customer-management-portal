# Production Deployment Plan (Draft)

## Overview
This document outlines the architecture and operational workflow to deploy the User Management Portal to a Linux host with:
- Automated installation (interactive) via `scripts/install.sh`
- systemd-managed backend (Node.js Express) and optional Telegram bot service
- Cloudflare-backed SSL certificates (Let's Encrypt via DNS challenge using certbot + Cloudflare plugin)
- Automatic certificate renewal
- In-app Control Panel (renamed from Remote Server) exposing certificate status/renew and update check/apply
- Update mechanism pulling from GitHub and rebuilding frontend assets atomically
- Seed data: default admin, 4 sample servers, 5 users per server

## Components
1. Backend Service: `cmp-backend.service`
2. Telegram Bot Service: `cmp-telegram-bot.service` (existing; will be cleaned to remove duplicate blocks)
3. Certificate Renewal: systemd timer `certbot-renew.timer` or cron entry
4. Installer Script: `scripts/install.sh` (bash) prompts for domain, email, Cloudflare API token, backend port, admin username/password
5. Storage Paths:
   - App root: `/srv/cmp` (default; configurable)
   - SSL certs: `/etc/letsencrypt/live/<domain>/` (managed by certbot)
   - Environment file: `/srv/cmp/backend/.env`
   - Logs: systemd journal (optional symlink to `/var/log/cmp/`)

## Environment Variables (.env)
```
PORT=<backend_port>
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=cmp
DB_USER=cmp
DB_PASSWORD=<generated_or_prompted>
START_TELEGRAM_BOT=true
CLOUDFLARE_API_TOKEN=<cf_token>
DOMAIN_NAME=<domain>
LETSENCRYPT_EMAIL=<email>
```
Additional future keys:
```
UPDATE_SOURCE=https://github.com/<owner>/<repo>.git
BACKEND_VERSION=<commit_or_tag>
```

## Installer Flow
1. Pre-flight checks: root privileges, dependencies (git, curl, node >= 18, npm/pnpm, certbot, postgresql-client, cloudflare dns plugin)
2. Prompt user for required inputs
3. Create system user `cmp` (optional) and directories
4. Clone repository (if not already present)
5. Install backend & frontend dependencies
6. Build frontend (`npm run build`)
7. Generate `.env`
8. Initialize PostgreSQL database: create role & database, run migrations (`node backend/run_migrations.js`)
9. Seed default admin + sample servers + users
10. Run initial certificate issuance: `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.cloudflare.ini -d <domain> --email <email> --agree-tos --non-interactive`
11. Enable and start systemd services
12. Output summary (URLs, admin credentials reminder, certificate expiry)

## Control Panel Endpoints (Backend)
All endpoints under `/api/admin/control` (ADMIN only):
- `GET /cert/status` → { domain, issuer, notBefore, notAfter, daysRemaining }
- `POST /cert/issue` → triggers initial issuance (if absent) via certbot (spawns child process)
- `POST /cert/renew` → forces renewal attempt, returns result + audit
- `GET /update/check` → fetches latest tag/commit from GitHub & compare local HEAD
- `POST /update/apply` → run safe update (git fetch/pull, install deps if changed, rebuild frontend) with rollback guard

## Update Mechanism (Safe Flow)
1. `git fetch origin --tags`
2. Determine target (latest tag or main HEAD)
3. Show diff summary (changed files count)
4. Create temp backup of current build artifacts & package lock
5. Apply pull
6. Install dependencies only if lockfile changed (`npm ci`)
7. Build frontend
8. If build succeeds, write new BACKEND_VERSION and restart services
9. On failure, revert using backup and report audit entry (status: update_failed)

## Audit Logging
Table: `settings_audit` + new table `control_panel_audit`:
```
control_panel_audit(id serial pk, admin_id int, action text, payload jsonb, created_at timestamptz default now())
```
Actions: `cert_issue`, `cert_renew`, `update_check`, `update_apply_success`, `update_apply_failed`

## Security Considerations
- Cloudflare API token stored in `.env` (chmod 600). Installer writes `/root/.cloudflare.ini` (600) for certbot plugin.
- Restart & update endpoints restricted to ADMIN + CSRF token (frontend) + fresh JWT
- Avoid exposing private key material via APIs (cert/status parses certificate only)
- Validate port changes (1-65535; disallow <1024 unless running as root)

## Frontend UI (Control Panel)
Rename existing tab label to "Control Panel".
Sections:
1. Certificate (domain, expiry progress bar, buttons: Issue / Renew)
2. Updates (current version, latest available, buttons: Check, Apply Update)
3. Admin Actions Log (recent audit entries)
4. Cloudflare Config (masked token state; show last 4 chars; reveal requires password confirm)

## Certificate Renewal
- systemd timer runs: `certbot renew --quiet` twice daily
- After renewal, a post-hook script triggers backend restart only if certificate changed (compare mod time or hash)

## Sample Data Seeding
Servers (4): Alpha, Beta, Gamma, Delta
Users per server (5): rotate service_type [Mini, Basic, Unlimited, Mini, Basic]; stagger expire_date (now + 5, 15, 25, 35, 45 days)

## Next Steps (Implementation Order)
1. Add service file & plan doc (this file)
2. Installer script skeleton
3. Seed script enhancements
4. Backend endpoints & audit table
5. Frontend Control Panel UI
6. Update & cert integration
7. Documentation finalization

---
Draft version — will evolve as implementation proceeds.
