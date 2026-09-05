# v1.9.15 — Update & Swap Mechanism Hardening

## What's New

### Update & Swap Mechanism Hardening
- **Proactive Stale Swap Auto-Cleaning**:
  - Live updates and update scripts now automatically detect, deactivate (`swapoff`), and delete leftover `cmp-build-swap*` files across `/tmp`, `/var/tmp`, and `/srv/cmp` at the very beginning of the update.
  - Automatically heals servers where `/tmp` was stuck at 100% capacity from a previous failed update.
  - Backend API (`/control/update/run`) proactively cleans stale swap files before resolving release tags or downloading scripts.
- **Disk-Backed Swap Allocation**:
  - Swap files are strictly prohibited from being created on `tmpfs`, `ramfs`, or `devtmpfs`.
  - Targets persistent disk partitions (`/srv/cmp`, `/var/tmp`, or `/cmp-build-swap`) where disk space is ample.
  - Dynamically sizes swap based on available partition space (1536MB, 1024MB, or 512MB) while guaranteeing at least 1GB of disk headroom.
- **Existing Swap Detection**:
  - Inspects `/proc/meminfo` before attempting swap creation. If the host already has 1GB+ free swap, temporary swap allocation is completely bypassed.
- **Global Cleanup Traps**:
  - Installed comprehensive `trap cleanup EXIT INT TERM` handlers in `update-unattended.sh` and `update-vps.sh` ensuring temporary swap files are always safely deactivated and deleted regardless of when or why an update exits.
- **Container / Restricted Host Fallbacks**:
  - In environments where `swapon` is restricted (such as unprivileged LXC or Docker containers without `CAP_SYS_ADMIN`), failure to enable swap is non-fatal.
  - The scripts clean up the allocated file, issue a warning, and proceed with conservative Node heap flags (`--max-old-space-size=768`) to prevent out-of-memory errors without aborting the update.
- **Safe Base Temporary Directory**:
  - If `/tmp` is a `tmpfs` or has low free space, downloads and database backups automatically divert to `/var/tmp` or `/srv/cmp`.
- **Pre-Update Backup Optimization in `update-vps.sh`**:
  - Excludes `node_modules` from pre-update backups to prevent RAM and disk exhaustion.

---

## Upgrade Notes
- No database migrations are required.
- If upgrading via the Web UI Live Update, the new update script will automatically remove any stale `/tmp/cmp-build-swap` file and proceed smoothly.
