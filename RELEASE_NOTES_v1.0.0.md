# Customer Management Portal – v1.0.0

Initial public release.

## Highlights
- Auto-detect materialized view support (exists + unique index) with optional env override
- Quiet-by-default HTTP request logs; enable `VERBOSE_HTTP_LOG=1` for troubleshooting
- Backend serves the built frontend directly (Vite) for simpler deployment
- Admin matview widget with coalesced refresh and health visibility
- New `backend/.env.example` and MIT `LICENSE`

## Install
One-liner (immutable tag):

```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.0/scripts/install.sh | bash"
```

## Upgrade notes (pre-1.0 → 1.0.0)
- Matview flag is now auto-detected (presence + unique index); env override remains as `USE_USER_STATUS_MATVIEW`.
- Verbose request logs are off by default; temporarily enable via `VERBOSE_HTTP_LOG=1`.
- Backend serves the built frontend from `frontend/dist`; typical deployments use one systemd service.
- Removed the "Frontend Dev Port" feature; dev port is fixed to 5173.

## Changelog
See the `CHANGELOG.md` entry for 1.0.0 (2025-11-09).
