# v1.8.3 — Cleanup Button & DB Mobile Layout

## What's New

### Clean Up Button (Control Panel → Update)
- Added **Clean Up** button in the Update section of the Control Panel
- Scans and deletes leftover `/tmp/cmp_update_*` backup directories and `/tmp/cmp-updater-*.sh` scripts from previous updates
- Shows a real-time **progress popup** (streaming SSE) with green/amber/red log lines and a progress bar
- Reports how many items were deleted; streamed output is displayed in a scrollable monospace log
- Action is recorded in the control panel audit log

### Database Page Mobile Layout Fix
- DB status grid already responsive (3→2→1 cols); `largest tables` grid now collapses to 2 cols on very small screens
- Backup button row (`config.json`, `database.db`, `Telegram snapshot`, `Backup Now`) wraps cleanly on narrow screens — buttons pair up on small screens instead of overflowing

## Bug Fixes / Improvements
- Cleanup button is disabled while an update or cleanup is already running
- Cleanup modal progress bar animates while running, shows green on success / red on failure
- All leftover `/tmp/cmp_update_YYYYMMDD_HHMMSS/` dirs and `/tmp/cmp-updater-*.sh` files are removed

## Upgrade Notes
No database migrations or configuration changes required. Update via the GUI Update button or run the update script manually.
