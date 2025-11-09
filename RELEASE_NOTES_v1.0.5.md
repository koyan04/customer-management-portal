# Release Notes — v1.0.5

Date: 2025-11-10

## What’s Fixed

- Fresh installs on some VPSs failed with `Error applying migrations: relation "users" does not exist`.
  - Migrations: wrapped the `display_pos` backfill and index creation for `users` in guards so they are skipped cleanly if the table isn't present yet (legacy/partial setups).
  - Installer: now optionally checks out a specific ref (tag/branch) via `CMP_CHECKOUT_REF` or auto-checks out the latest tag to ensure the installed codebase contains the newest migrations. The installer also fails fast if migrations fail.

## How to Install

- One-liner (Debian/Ubuntu):
  - To stick to a specific release: set `CMP_CHECKOUT_REF=v1.0.5` in the environment before running the installer.
  - Or rely on the installer to auto-select the latest tag.

## Notes

- No changes to `scripts/install.sh` integrity baseline are required unless you enforce a hash in CI; if you do, update the baseline accordingly.
- Existing installations are unaffected; you can rerun migrations safely.
