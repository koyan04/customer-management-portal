# Public_Release: Included and Excluded Files

This document lists which files and folders I propose to include under `Public_Release/` when preparing the release tree to push to `origin/main`, and which files/folders should be explicitly excluded from the Public release. Please review and confirm or request changes.

---

## Summary

- Goal: make the GitHub repository root mirror `Public_Release/*` exactly.
- Before pushing, copy the files listed under **Included** into `Public_Release/` so the release is self-contained.
- I will not modify or remove your local development branches or working tree; a temporary worktree will be used for the preview and push.

---

## Files/Paths Proposed for Inclusion (minimal + optional)

Below is a filtered, evidence-backed list focused on the files that are required for a minimal VPS install and runtime, plus recommended optional helpers for operators. I reviewed references (installers, systemd units, package.json, and READMEs) to determine which scripts are actually called.

-- Minimal (required for installation and runtime)
  - Top-level: `README.md`, `LICENSE`, `VERSION`, `WINDOWS_INSTALL.md`
  - Installer helpers: `scripts/install.sh`, `scripts/bootstrap.sh`, `scripts/install-windows.ps1`, `scripts/install.sha256.baseline`
  - Backend runtime: `backend/package.json`, `backend/.env.example`, `backend/pm2.config.js` (if PM2 used), `backend/README.md`
  - Migrations (CRITICAL): copy all files from `backend/migrations/` into `Public_Release/backend/migrations/` (e.g. `000_schema.sql`, `001-*.sql`, …)
  - Systemd / service templates: `backend/systemd/*` (service and timer templates referenced by README and installer)
  - Scripts that are invoked by installer or systemd and therefore required:
    - `backend/scripts/run_migrations.js` (installer calls `node run_migrations.js`)
    - `backend/scripts/seed_default_settings.js` (installer runs this if present)
    - `backend/scripts/check_cert_expiry.js` (used by `cmp-cert-expiry.service`)
    - `backend/scripts/worker.js` (used by `cmp-worker.service`)
    - `backend/scripts/refresh_matview_once.js` (used by `cmp-matview-refresh.service`)
    - `backend/scripts/cleanup_uploads.js` (exposed as `cleanup-uploads` npm script)

-- Recommended operator helpers (include if you want operator tools available)
  - Telegram helpers: `backend/scripts/verify_telegram.js`, `backend/scripts/read_bot_status.js`, `backend/scripts/set_telegram_settings.js`
  - Migration/maintenance helpers: `backend/scripts/run_single_migration.js`, `backend/scripts/run_migration_servers_display_pos.js`
  - Data operations: `backend/scripts/backfill_pricing_audit.js` and its auxiliary helpers (`_verify_backfill.js`, `_sample_backfill_rows.js`, `_count_backfill_results.js`) — useful but optional
  - `backend/scripts/probe_xlsx.js` (operator/debug helper referenced in README)

-- Optional release scripts to copy into `Public_Release/scripts/`
  - `scripts/ci/check_release_requirements.sh` (CI installer validation)
  - `scripts/service-control.sh` and `scripts/service-control.ps1` (helper scripts added to working tree)
  - `scripts/WINDOWS_QUICKCHECK.ps1`, `scripts/WINDOWS_FIX_PG_PATH.ps1`


---

## Files/Paths Proposed for Exclusion (do NOT include in Public_Release)

These items should be explicitly excluded from the Public release tree and must NOT be pushed into `origin/main` as part of the Public_Release mirror:

- `node_modules/` (backend or frontend) — platform-specific and large; do not include
- `frontend/src/` (source) — do not include unless you explicitly want dev sources published
- `backend/tests/`, `frontend/__tests__/`, and other test suites — exclude
- Local temporary files and artifacts: `temp_*`, `tmp_*`, `*.log`, `server.err`, `*.tmp`
- Local backup files: `*.bak`, `*_backup.json`, etc.
- Local environment or secret files: `.env`, `.env.local`, secrets, and other private configs
- Local git metadata: `.git/` and related files
- Development-only helper scripts that are not needed for plain VPS installs (unless you want them in the release)

---

## Migration parity and verification

- I will compute and report checksums (SHA256) for each migration file in `backend/migrations/` and for the copies placed under `Public_Release/backend/migrations/` and list any mismatches.
- If any migration differs, I will flag it and not push until you confirm which version is canonical.

---

## Preview & push workflow (what I will do once you confirm)

1. Create a temporary worktree branch: `public-release-sync-temp`.
2. Copy the confirmed include files into the temp worktree root (so repo root matches `Public_Release/*`).
3. Commit a preview commit in the temp worktree and present the `git diff --name-status` and size summary for review.
4. After your approval, create a backup branch `pre-public-release-backup` pointing to the previous `origin/main` (and optionally push it), and (optionally) push `recover-local-dev` as a remote backup.
5. Push the preview commit to `origin/main` using your chosen push method:
   - Option A (recommended): push the preview commit as a normal update (no history rewrite).
   - Option B (advanced): replace `main` via a force-push (rewrites history). Use only if you explicitly want history rewritten.

---

## Questions for you / Confirmation required

1. Confirm the above include list (any additions or removals?).
2. Should I include `backend/package-lock.json` in the release? (recommended: yes)
3. Do you want `frontend/src/` published as part of the release? (default: no)
4. When we reach push time, do you prefer Option A (non-force commit) or Option B (force replace main)? (default: Option A)
5. Do you want me to push `recover-local-dev` and/or `pre-public-release-backup` to `origin` as remote backups before updating `main`? (I will only push with explicit approval.)

---

Once you confirm or modify the list above I'll: (a) copy the listed files into `Public_Release/` in the working tree, (b) create the preview commit in a temporary worktree and present the diff/stat and migration parity results for your approval.

Thank you — please reply with your confirmations or edits.
