# v1.9.17 — Update Script DB Backup Hardening & UI Layering Fix

## What's New

### 1. Database Backup Hardening in Update Scripts
- **Fixed Update Script Freezing on Database Backup**:
  - Addressed root cause where `scripts/update-vps.sh` and `backend/scripts/update-unattended.sh` hung indefinitely on `→ Backing up database...`.
  - When PostgreSQL authentication requires password (e.g. `local all all md5` configured by installer), `pg_dump` previously stalled attempting to prompt for a password on `/dev/tty` with suppressed stderr.
  - Added `-w` (`--no-password`) flag ensuring `pg_dump` never prompts for a password and fails fast instead of hanging.
  - Added `PGCONNECT_TIMEOUT=5` and `--lock-wait-timeout=10000` (10 seconds) to prevent stalls on network timeouts or open table locks.
  - Added `run_with_timeout 30` wrapper to guarantee the backup step cannot exceed 30 seconds under any circumstances.
  - Automatically reads actual database credentials (`DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`) from `/srv/cmp/backend/.env`, eliminating failures from hardcoded `cmp` database name.
  - Multi-tier fallback order:
    1. App credentials with password from `.env` via TCP/socket.
    2. Non-interactive `sudo -n -u postgres` peer authentication.
    3. Direct `su` peer authentication when running as root.
    4. Graceful continuation with an informative warning if credentials are unavailable.

### 2. Navbar Dropdown Z-Index Stacking Context Fix
- **Fixed Avatar & Key Dropdowns Rendered Under Page Content**:
  - Resolved UI bug where the avatar menu was clipped behind action buttons (e.g. "Back to Server List", "Key Management", "Export", "Import") on `ServerDetailPage` due to missing stacking context on `.main-header`.
  - Added `position: relative; z-index: 1000;` to `.main-header` and `position: relative; z-index: 1;` to `.main-content`.
  - Set `z-index: 1050;` on `.header-avatar` and `z-index: 1040;` on `.nav-link-key`.

---

## Upgrade Notes
- No database migrations are required.
- Upgrades can be performed via the Web UI Live Update or via:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/update-vps.sh | sudo bash
  ```
