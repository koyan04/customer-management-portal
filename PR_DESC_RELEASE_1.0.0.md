Title: Release 1.0.0 – Initial public release

Summary
-------
This PR merges `feature/admins-audit-redact` into `main` for the 1.0.0 public release. Highlights:

- Auto-detect materialized view support (exists + unique index) with optional env override
- Quiet-by-default HTTP request logs; enable `VERBOSE_HTTP_LOG=1` for troubleshooting
- Backend serves the built frontend directly (Vite) for simpler deployment
- Admin matview widget with coalesced refresh and health visibility
- New `backend/.env.example` and MIT `LICENSE`
- Documentation: installation, security notes, upgrade notes

Changelog
---------
See `CHANGELOG.md` – 1.0.0 – 2025-11-09.

Upgrade notes (pre-1.0 → 1.0.0)
-------------------------------
- Matview flag is now auto-detected (presence + unique index); env override remains as `USE_USER_STATUS_MATVIEW`.
- Verbose request logs are off by default; temporarily enable via `VERBOSE_HTTP_LOG=1`.
- Backend serves the built frontend from `frontend/dist`; typical deployments use one systemd service.
- Removed the "Frontend Dev Port" feature; dev port is fixed to 5173.

Installer
---------
- README one-liner currently points to the immutable `v1.0.0` tag to avoid 404s until `main` is updated:
  
  curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.0/scripts/install.sh | bash

- After merging to `main`, we can optionally switch the README one-liner back to the `main` branch URL.

Verification
------------
- Backend tests pass locally (including matview detection and health endpoints)
- Frontend builds with Vite and integration tests pass
- Manual smoke: backend serves built `index.html`; `/api/health` returns version `cmp ver 1.0.0`

Risk & Rollback
---------------
- Touches both backend and frontend; keep `main` deploy gated. If issues arise, roll back by deploying the previous tag/commit and restoring 
  the prior README installer link if needed.

Notes
-----
- The tag `v1.0.0` already exists and is pushed to origin.
- Separate GitHub Release can use `RELEASE_NOTES_v1.0.0.md` as the description.
