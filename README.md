# Customer Management Portal

Full-stack portal for managing servers and user accounts with role-based access (Admin, Server Admin, Viewer), Telegram notifications, XLSX import/export, audit trails, and financial reporting.

**Current Version:** `cmp ver 1.9.10`

**Repository:** https://github.com/koyan04/customer-management-portal

## Features

- **User Management**: Enable/disable users, XLSX import/export, status tracking (Active/Soon/Expired), user transfer between servers
- **Role-Based Access**: Admin (global), Server Admin (per-server), Viewer (read-only) with granular permissions
- **Financial Reports**: Monthly snapshots, tier counts (Mini/Basic/Unlimited), revenue tracking
- **Telegram Bot**: Login notifications, scheduled reports, health monitoring
- **Audit & Security**: Full audit trails, password reset tracking, JWT authentication, avatar management
- **Production Ready**: Materialized views, Prometheus metrics, systemd services, automated backups

## Quick Install

### Linux (Recommended)

**Prerequisites:** Ubuntu/Debian with sudo, Node.js 18+, PostgreSQL

```bash
# Fresh installation (installs prerequisites + app)
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/bootstrap.sh | bash"
```

The installer will:
- Download latest release
- Install dependencies and build frontend
- Create database and run migrations
- Request SSL certificate (Cloudflare DNS or HTTP-01)
- Create systemd services
- Seed initial admin account

**Access:** `https://YOUR_DOMAIN` (login with credentials from install)

### Windows

See [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md) for detailed manual installation guide.

**Quick setup** (requires Administrator PowerShell):
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\scripts\install-windows.ps1 -InstallDir C:\srv\cmp -InstallPostgres
```

## Quick Update

### VPS/Production Update

```bash
# Update to latest version (automatic)
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/update-vps.sh | sudo bash
```

The update script will:
- Backup current installation and database
- Download and extract latest release
- Preserve `.env`, logos, and avatars
- Install dependencies and rebuild frontend
- Run database migrations
- Restart services
- Verify health

**Rollback** (if needed):
```bash
# Instructions provided by update script
systemctl stop cmp-backend cmp-telegram-bot
rm -rf /srv/cmp
cp -r /tmp/cmp_backup_<timestamp>/cmp /srv/cmp
sudo -u postgres psql cmp < /tmp/cmp_backup_<timestamp>/database.sql
systemctl start cmp-backend cmp-telegram-bot
```

### Local Development Update

```bash
cd /path/to/customer-management-portal
git pull origin main
cd backend && npm install
cd ../frontend && npm install && npm run build
node backend/run_migrations.js
systemctl restart cmp-backend  # or restart manually
```

## Configuration

**Environment Variables** (`backend/.env`):

```env
PORT=3001
DOMAIN_NAME=example.com
LETSENCRYPT_EMAIL=you@example.com
CLOUDFLARE_API_TOKEN=cf_api_token_here
START_TELEGRAM_BOT=true
JWT_SECRET=replace_me_with_strong_secret
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=cmp
DB_USER=cmp
DB_PASSWORD=changeme
```

**Manual Migration & Seeding:**

```bash
cd /srv/cmp/backend
node run_migrations.js
SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin123 node seedAdmin.js
node seedServers.js
node seedUsers.js
```

## Usage

- **Settings** → General: site name, logo, favicon, timezone
- **Servers**: add/edit/reorder servers
- **Users**: XLSX import/export, status filters, enable/disable
- **Accounts**: manage admins/permissions
- **Telegram**: bot token, notifications config
- **Backups**: download/restore config and database

## Documentation

- [Windows Installation Guide](WINDOWS_INSTALL.md) - Detailed manual setup for Windows
- [VPS Deployment Guide](VPS_DEPLOYMENT.md) - Production deployment checklist  
- [Testing Guide](TESTING_GUIDE.md) - Testing and verification procedures
- [Contributing](CONTRIBUTING.md) - Development workflow and PR guidelines
- [Security](SECURITY.md) - Responsible disclosure for vulnerabilities
- [Release Notes v1.9.4](release-notes-1.9.4.md) - Latest release details
- [Release Notes v1.4.5](release-notes-1.4.5.md) - Previous release

## Development

```bash
# Frontend (runs on port 5173)
cd frontend && npm run dev

# Backend (runs on port 3001)
cd backend && node index.js

# Tests
cd backend && npm test
cd frontend && npm test
```

## Troubleshooting

### Service not starting
```bash
# Check logs
journalctl -u cmp-backend -n 50
systemctl status cmp-backend

# Verify database connection
cd /srv/cmp/backend && node -e "require('./db')"
```

### Migration errors
```bash
# Re-run migrations
cd /srv/cmp/backend
node run_migrations.js
```

### Timezone issues
Use IANA timezone names (e.g., `Asia/Yangon`) not offsets (e.g., `GMT+6:30`) in Settings → General.

### Integrating with an existing nginx (multiple domains)

If your VPS already runs nginx serving other domains, the installer will add the
portal and key server as **separate vhost files** without touching your existing
sites. It uses `systemctl reload nginx` (non-disruptive) instead of `restart`.

**Option A — Let the installer do it (recommended):**
```bash
# Provide the portal domain and key server domain up front
sudo DOMAIN=portal.example.com KEYSERVER_DOMAIN=key.example.com \
  bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/bootstrap.sh | bash"
```
The installer now:
- Creates `cmp-<portal>.conf` and `cmp-<key>.conf` vhosts under `/etc/nginx/sites-available/`
- Never overwrites an existing vhost file
- Reloads nginx (existing domains keep serving during the apply)
- Exposes the key server on its public domain → `127.0.0.1:8088`

**Option B — Add vhosts to an already-running nginx manually:**
```bash
wget https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/integrate-nginx.sh
chmod +x integrate-nginx.sh
sudo ./integrate-nginx.sh \
  --portal-domain portal.example.com \
  --key-domain key.example.com \
  --backend-port 3001 \
  --key-port 8088
```
The `integrate-nginx.sh` helper:
- Adds the portal and key server vhosts as isolated files
- Runs `nginx -t` before applying anything
- Uses `systemctl reload nginx` so existing domains are never interrupted
- Never stops nginx and never overwrites existing vhost files
- Falls back to HTTP-only automatically if no certificate exists yet

**Verify the key server is reachable:**
```bash
curl -fsS http://127.0.0.1:8088/health   # key server process
curl -fsS https://key.example.com/health # through nginx (if TLS configured)
```

### Serving the portal on port 443 alongside Xray (VPN server)

If your VPS runs **Xray** (which owns ports 80/443 for VPN traffic), nginx
cannot bind to 443 directly. The standard solution is **Xray's `fallback`**
feature: Xray keeps 443 for VPN, and forwards non-VPN (browser) traffic to
nginx on a non-conflicting port (e.g. `127.0.0.1:8443`), where nginx terminates
TLS with the portal's certificate.

```
Browser → https://DOMAIN (443)
   → Xray (owns 443)
      → VPN client?  → handled by Xray (untouched)
      → Browser?     → fallback → nginx 127.0.0.1:8443 → backend :3001
```

**Automated setup:**
```bash
wget https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/setup-portal-443.sh
chmod +x setup-portal-443.sh
sudo ./setup-portal-443.sh --domain ynparadise.dpdns.org
```
The `setup-portal-443.sh` helper:
- Obtains a Let's Encrypt certificate for the portal domain (HTTP-01)
- Auto-detects a free port (e.g. `127.0.0.1:8443`, or `8444`/`9443` if Xray
  already owns 8443) and creates an nginx vhost there (NOT 443) that terminates
  TLS and proxies to the backend
- Prints the exact Xray `fallbacks` block to add to your 443 inbound
- Reloads nginx non-disruptively

**Manual Xray fallback config** — add this to the inbound that listens on 443,
inside its `streamSettings` → `realitySettings` (or `tlsSettings`), using the
port nginx actually listens on (check with `sudo ss -ltnp | grep nginx`):
```json
"fallbacks": [
    { "dest": "127.0.0.1:8443", "xver": 1 }
]
```
Then restart Xray: `systemctl restart xray`

> **Note:** If Xray already owns port 8443 (common on 3x-ui panels), pick a
> different free port for nginx (e.g. `8444`) and use that in the fallback.

> **Note:** For a REALITY inbound, the `dest` in `realitySettings` should point
> to the portal domain (e.g. `"dest": "ynparadise.dpdns.org:443"`) so the TLS
> handshake presents the portal's certificate to probing clients, while the
> `fallbacks` entry forwards real browser traffic to nginx.

### TLS/Certificate issues

If certificate generation fails during installation (DNS-01 or HTTP-01):

**Quick Fix (Interactive):**
```bash
# Download the quick-fix helper and run it on the server
wget https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/quick-fix-keyserver-tls.sh
chmod +x quick-fix-keyserver-tls.sh
sudo ./quick-fix-keyserver-tls.sh
```

**Quick Fix (Domain-specific):**
```bash
# Repair a specific keyserver domain, reinstall the renewal hook, and reload nginx
sudo ./quick-fix-keyserver-tls.sh --domain key.vchannel.dpdns.org
```

The quick-fix script will:
- Auto-detect the domain from `.env` or nginx if it is not passed on the command line
- Repair the common keyserver vhost mistake where the public domain still proxies to port `3001` instead of `8088`
- Install a certbot deploy hook that reloads nginx after renewals
- Reload nginx after a successful fix so new certificates take effect immediately

**Common Issues:**

1. **Dynamic DNS Domains** (dpdns.org, no-ip.com, etc.)
   - Cannot use Cloudflare DNS-01 challenge
   - Must use HTTP-01 (requires port 80 open)
   - Run the quick-fix script so the vhost and renewal hook are corrected
   - If you still need to issue a new certificate, run `scripts/fix-tls.sh` after fixing DNS/port access

2. **Port 80 blocked**
   - Configure firewall: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`
   - Check DigitalOcean/AWS firewall rules
   - Test externally: `telnet YOUR_DOMAIN 80`

3. **Domain not resolving**
   - Verify DNS: `dig +short YOUR_DOMAIN`
   - Check public IP: `curl ifconfig.me`
   - Ensure they match

4. **HTTP mode (temporary workaround)**
   - Access via HTTP: `http://YOUR_DOMAIN:3001`
   - Not recommended for production
   - Fix certificates later with the script

**Manual certificate retry:**
```bash
sudo systemctl stop nginx cmp-backend
sudo certbot certonly --standalone -d YOUR_DOMAIN
sudo systemctl start nginx cmp-backend
```

**Automatic renewal behavior:**
- The installer and update flow now install a certbot deploy hook that reloads nginx after renewal
- Manual renewals from the admin API also reload nginx after `certbot renew`
- If a keyserver domain ever points at the wrong upstream again, rerun `scripts/quick-fix-keyserver-tls.sh`

### Health check
```bash
# Verify backend is running
curl -s http://127.0.0.1:3001/api/health | jq

# Expected response:
# {"ok":true,"versions":{"appVersion":"cmp ver 1.9.4",...}}
```

## Security

- **Secrets**: Use strong `JWT_SECRET` (32+ random bytes), never commit `.env`
- **HTTPS**: Use certbot (Linux) or win-acme (Windows) for SSL certificates
- **Database**: Use least-privilege DB user, enable automated backups
- **Admin Access**: Change default credentials immediately after install
- **Rate Limiting**: Consider adding rate limits on `/api/auth/login`

## Production Checklist

1. ✅ Change default admin password
2. ✅ Set strong `JWT_SECRET` in `.env`
3. ✅ Enable HTTPS with valid certificates
4. ✅ Configure automated database backups
5. ✅ Set up monitoring (`/metrics` endpoint)
6. ✅ Configure timezone (IANA format)
7. ✅ Test rollback procedure
8. ✅ Enable systemd services for auto-start

## License

MIT - See [LICENSE](LICENSE)

## Support

- **Issues**: https://github.com/koyan04/customer-management-portal/issues
- **Releases**: https://github.com/koyan04/customer-management-portal/releases
- **Latest**: [v1.4.6](https://github.com/koyan04/customer-management-portal/releases/tag/v1.4.6)
