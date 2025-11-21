# Release Notes — v1.1.0

Date: 2025-11-17

Highlights
- Stable installer: Bootstrap (`scripts/bootstrap.sh`) and installer (`scripts/install.sh`) now lock to the release tag and no longer attempt any dynamic “latest” detection. This eliminates mismatched downloads and Git credential prompts.
- Migration compatibility: Fixed legacy migration (`2025-10-23-add-pricing-defaults.sql`) to satisfy the `app_settings.general` trigger by setting `updated_by` to `system_migration` during schema/data updates.
- Tag integrity: Release assets are referenced strictly by tag. The installer honors `CMP_CHECKOUT_REF` to force a specific ref when needed.

Changes
- chore(install): set default `TAG` to `v1.1.0` in installer and bootstrap
- fix(install): remove dynamic tag fetching logic entirely
- fix(db): set `updated_by = 'system_migration'` in pricing defaults migration
- docs: README updated to reflect v1.1.0 and correct install commands
- ops: clarified verification examples (SHA256) and non-Debian invocation

Upgrade Guidance
- Fresh installs: Run the v1.1.0 bootstrap one-liner from README.
- Existing installs: No special action required unless you rely on the one-line installer for upgrades. To upgrade via tarball, set `CMP_CHECKOUT_REF=v1.1.0` then run the installer from README.

Verification
- Installer URLs in README and scripts reference `v1.1.0`.
- `scripts/install.sh` contains: `TAG="${CMP_CHECKOUT_REF:-v1.1.0}"`.
- `scripts/bootstrap.sh` contains: `TAG="v1.1.0"`.

Known Issues
- Certbot DNS challenge depends on Cloudflare token scope and propagation time. See README for HTTP-01 fallback and propagation tuning.

Thank you for your patience while we stabilized the installer process.
