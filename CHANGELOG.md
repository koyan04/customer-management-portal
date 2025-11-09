# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0 – 2025-11-09

- Initial public release
  - Auto-detect materialized view support (exists + unique index) with optional env override
  - Quiet-by-default HTTP request logging; enable via `VERBOSE_HTTP_LOG=1`
  - Backend serves built frontend directly for simplified deployment
  - Added `backend/.env.example` and MIT `LICENSE`
  - Documentation: installation guide, security notes, upgrade notes
  - Admin matview widget with coalesced refresh and health visibility

## 1.0.1 – 2025-11-10

- Installer enhancement: auto-install Node.js 20.x LTS if missing (Debian/Ubuntu via NodeSource)
  - Set `CMP_SKIP_NODE_AUTO_INSTALL=1` to disable and require preinstalled Node
  - Improves first-time install experience on minimal servers

## 2025-11-08

- Removed the entire "Frontend Dev Port" feature across backend and frontend:
  - Deleted backend admin endpoints for dev port status/control/restart and related audit paths
  - Removed frontend Settings UI, modal, progress bar, and persisted toast mechanics for restart flow
  - Simplified Vite config to static port (5173), deleted `frontend/devServer.config.json`
- Backend now serves the production frontend build directly:
  - `backend/app.js` serves `frontend/dist/` and includes SPA fallback for non-API routes
  - This enables a single systemd service to run the full app
- Installer improvements (`scripts/install.sh`):
  - Prompts for domain, email, backend port, and initial admin credentials
  - Supports Cloudflare auth via API Token (recommended) or Global API Key (new)
  - Issues certificate via certbot (DNS challenge) and configures a post-renew hook to restart backend
  - Seeds default admin, four sample servers, and five sample users per server on fresh installs
- Documentation:
  - Added repository `README.md` with installation, features, usage, and notes
  - Added sample Nginx reverse proxy configuration (see `deploy/nginx.sample.conf`)
  - Added example systemd worker unit for future async tasks (`backend/systemd/cmp-worker.service`)
- Tests:
  - Added integration test to verify the backend serves `index.html` from the built frontend
