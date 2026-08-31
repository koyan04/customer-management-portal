# v1.9.12 — Financial Snapshot & Nav Menu Fixes

## What's New

### Automatic Financial Snapshot Reliability
- The monthly snapshot scheduler now performs a **startup catch-up**: when the service starts, it generates the permanent financial snapshot for the most recently completed month if it was missed
- This prevents skipped month-end snapshots when the backend is down or restarted around the month boundary

## Bug Fixes

- **Financial page — Monthly revenue**: the `Current` status is now detected using the app timezone instead of raw UTC, so the current month is labeled correctly (previously the previous month could incorrectly show `Current` around month boundaries)
- **Nav bar generator menu**: clicking a menu item (Key Manager / YAML Generator / JSON Generator) no longer lets the click leak through and re-collapse the menu; navigation now proceeds cleanly

## Upgrade Notes

No database migrations are required.

## Verification

- Restart the backend: the log prints a startup catch-up for the previous month, and a snapshot appears for it if none existed
- On the Financial page, only the actual current month shows the `Current` status badge
- Opening the generator menu in the top nav and clicking an item navigates to the correct page without the menu jumping back