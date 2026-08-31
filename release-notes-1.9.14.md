# v1.9.14 — Uninstaller & Docs Update

## What's New

### Server uninstaller (`scripts/uninstall.sh`)
- Added a dedicated **uninstall script** that cleanly reverses a production installation on the server
- Removes and disables all managed systemd units & timers:
  - `cmp-backend.service`, `cmp-telegram-bot.service`, `cmp-worker.service`
  - `cmp-cert-expiry.service` + `.timer`, `cmp-matview-refresh.service` + `.timer`
- Removes the Nginx vhosts for the **portal domain(s)** and the **key server domain** (then runs `nginx -t` and reloads)
- Removes **Let's Encrypt certs** (`live/`, `archive/`, `renewal/`) for those domains and the `cmp-post-renew.sh` deploy hook
- Removes `/root/.cloudflare.ini` (Cloudflare credentials) and the renew hook
- **Optionally** drops the PostgreSQL **database + role** read from `.env` (separate confirmation prompt)
- Removes `/srv/cmp` (the application directory)
- Cleans up pm2 `cmp-backend` / `cmp-telegram-bot` processes when pm2 is used
- Tidies leftover installer artifacts (`CMP TEMP TRUST` markers in `pg_hba.conf`, stale backup files)

### Uninstaller safety options
- Requires root and a typed `YES` confirmation before removing anything
- `--yes` — skip all confirmation prompts
- `--dry-run` — preview what would be removed without changing anything
- `--keep-env` — back up `.env` + `backend/data/keyserver.json` to `/root/cmp-uninstall-backup` before removal
- `--keep-db`, `--keep-nginx`, `--keep-certs`, `--keep-configs`, `--keep-app` — skip individual categories
- `--purge-all` — remove everything selected (default behaviour with confirmations)

### Documentation
- Added a **Uninstall** section to `README.md` and an **Uninstall / Cleanup** subsection to `VPS_DEPLOYMENT.md`
- Both documents the direct command and the downloadable standalone script, plus all flags

## Bug Fixes / Improvements
- Removed the leftover `cmp-cert-renew.service` / `cmp-cert-renew.timer` units if present
- Only reloads Nginx after vhost removal if `nginx -t` still passes (never breaks unrelated vhosts)

## Upgrade Notes
- No database migrations are required
- The uninstaller ships inside the release tarball at `scripts/uninstall.sh`

## Commands
```bash
# Read-only preview of what would be removed
sudo bash /srv/cmp/scripts/uninstall.sh --dry-run

# Full uninstall (interactive confirmations)
sudo bash uninstall.sh

# Unattended full uninstall
sudo bash uninstall.sh --yes
```