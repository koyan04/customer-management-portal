# v1.9.12 — Financial Snapshot & Nav Menu Fixes

## What's New

### Automatic Financial Snapshot Reliability
- The monthly snapshot scheduler now performs a **startup catch-up**: when the service starts, it generates the permanent financial snapshot for the most recently completed month if it was missed
- This prevents skipped month-end snapshots when the backend is down or restarted around the month boundary

## Bug Fixes

- **Financial page — Monthly revenue**: the `Current` status is now derived from the server data (the latest month) instead of the browser clock, so the correct month is labeled `Current` even when the server and browser timezones differ
- **Nav bar generator menu**: clicking a menu item (Key Manager / YAML Generator / JSON Generator) no longer lets the click leak through and re-collapse the menu; navigation now proceeds cleanly
- **Installer — low-memory swap**: the installer now creates its temporary swap in disk-backed locations (the app directory or `/var/tmp`) instead of `/tmp`, which on some VPSes is a small tmpfs that cannot hold a 2 GB swap file. This fixes `dd: No space left on device` failures during the frontend build.

## Upgrade Notes

No database migrations are required.

## Verification

- Restart the backend: the log prints a startup catch-up for the previous month, and a snapshot appears for it if none existed
- On the Financial page, only the actual current month shows the `Current` status badge
- Opening the generator menu in the top nav and clicking an item navigates to the correct page without the menu jumping back
- On a low-memory VPS (less than 2 GB RAM), running the installer creates swap in a disk-backed directory and the frontend build completes successfully