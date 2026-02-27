# CMP v1.5.0 Release Notes

**Release Date:** 2025-06-13

## New Features

### Domain Manager
- Full CRUD management for proxy domains stored in PostgreSQL
- Add, edit, delete domains with CDN and Anti-DPI flags
- Domains are included in backup/restore operations
- New migration: `022-table-domains.sql`

### Key Manager
- Manage subscription keys with search, pagination, and batch operations
- Import keys from external sources
- Batch delete with confirmation
- Integrated with key server for serving subscription configs

### YAML Generator (Clash Config)
- Generate Clash/Meta proxy configurations from managed domains
- Multi-node support with per-node protocol settings (VMess, VLESS, Trojan, Shadowsocks, Hysteria2)
- Export all active nodes as plain text URI file (filename from suffix field)
- Save/load configuration presets

### JSON Generator (sing-box Config)
- Generate sing-box proxy configurations from managed domains
- Same multi-node and protocol support as YAML generator
- Export all active nodes as plain text URI file
- Save/load configuration presets

### Key Server
- Serves subscription configs on port 8088
- Auto-converts sing-box JSON configs to base64 proxy URIs for Xray/V2Box clients
- Raw sing-box format available via `?format=raw` query parameter
- `.meta.json` companion files for subscription-userinfo headers (upload, download, total, expire)

### Admin Backup & Restore
- Backup all admin accounts including profiles, password hashes, and avatar data
- Includes full audit logs: admins_audit, login_audit, password_reset_audit
- Includes permissions: viewer_server_permissions, server_admin_permissions
- Restore with Merge (skip existing) or Overwrite mode
- Current logged-in admin is protected during restore
- Styled backup/restore buttons in Admin Panel header

## Improvements

- **Export Nodes as Text**: Export button in Active Nodes section of both YAML and JSON generators, downloads `.txt` file with proxy URIs
- **Navbar Positioning**: Moved navigation bar closer to the right edge in desktop view for better layout
- **Backup/Restore Enhanced**: Main backup now includes domains table and keyserver configuration
- **expire_date Handling**: Timezone-aware date handling for user expiration dates in backup/restore

## Bug Fixes

- Fixed PostgreSQL reserved word conflict: `old` and `new` columns in admins_audit table now properly quoted
- Fixed V2Box compatibility: Key server auto-converts sing-box JSON to base64 proxy URIs for Xray-core clients
- Fixed admin backup file reading for both multer buffer and disk path modes
- Fixed sequence reset during admin restore to prevent ID conflicts

## Database Migrations

- `022-table-domains.sql` — Creates domains table for domain manager feature

Migrations run automatically via `run_migrations.js` during install and update.

## New Files

### Backend
- `backend/routes/domains.js` — Domain manager API routes
- `backend/routes/keyserver.js` — Key server management and subscription serving
- `backend/data/keyserver.json` — Key server configuration (configDir, port)
- `backend/migrations/022-table-domains.sql` — Domains table schema

### Frontend
- `frontend/src/pages/DomainManagerPage.jsx` + `.css`
- `frontend/src/pages/JsonGeneratorPage.jsx` + `.css`
- `frontend/src/pages/KeyManagerPage.jsx` + `.css`
- `frontend/src/pages/YamlGeneratorPage.jsx` + `.css`

## Upgrade Notes

For existing installations:

```bash
# Standard update (handles everything automatically)
bash scripts/update-vps.sh

# Or manual steps:
cd /srv/cmp/backend && npm install
cd /srv/cmp/backend && node run_migrations.js
cd /srv/cmp/frontend && npm install && npm run build
mkdir -p /srv/cmp/configs
sudo systemctl restart cmp-backend
```

## Verification

```bash
# Check version
curl -s http://127.0.0.1:3001/api/health | jq '.versions.appVersion'
# Expected: "cmp ver 1.5.0"

# Check domains table exists
sudo -u postgres psql -d cmp -c "SELECT count(*) FROM domains;"

# Check key server (if configured)
curl -s http://127.0.0.1:8088/
```
