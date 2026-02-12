# Customer Management Portal

Full-stack portal for managing servers and user accounts with role-based access (Admin, Server Admin, Viewer), Telegram notifications, XLSX import/export, audit trails, and financial reporting.

**Current Version:** `cmp ver 1.4.6`

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
- [Release Notes v1.4.6](release-notes-1.4.6.md) - Latest release details
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

### Health check
```bash
# Verify backend is running
curl -s http://127.0.0.1:3001/api/health | jq

# Expected response:
# {"ok":true,"versions":{"appVersion":"cmp ver 1.4.6",...}}
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
