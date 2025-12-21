# VPS Deployment Guide - v1.4.1

## VPS Information
- **IP**: 178.128.26.133
- **User**: root
- **SSH Key**: `C:\Users\Ko Yan\projects\vc-opsh`

## Quick Update to v1.4.1

### 1. Connect to VPS
```powershell
# From Windows
ssh -i "C:\Users\Ko Yan\projects\vc-opsh" root@178.128.26.133
```

### 2. Backup Current State
```bash
# Backup database
sudo -u postgres pg_dump cmp > /tmp/cmp_backup_$(date +%Y%m%d_%H%M%S).sql

# Backup logos (IMPORTANT!)
cd /srv/cmp/backend
node scripts/backup_logos.js

# Or manually backup logos directory
cp -r /srv/cmp/backend/public/logos /tmp/logos_backup_$(date +%Y%m%d_%H%M%S)
```

### 3. Update Code
```bash
cd /srv/cmp
git fetch origin
git checkout v1.4.1
```

### 4. Install Dependencies (if needed)
```bash
# Backend
cd /srv/cmp/backend
npm install

# Frontend
cd /srv/cmp/frontend
npm install
npm run build
```

### 5. Migrate Logos to New System
```bash
cd /srv/cmp/backend

# If you have existing logos in uploads, migrate them
node scripts/migrate_logos.js

# Or restore from backup if needed
node scripts/restore_logos.js
```

### 6. Restart Services
```bash
sudo systemctl restart cmp-backend
sudo systemctl restart cmp-telegram-bot

# Check status
sudo systemctl status cmp-backend
sudo systemctl status cmp-telegram-bot
```

### 7. Verify Deployment
```bash
# Check version (should show: cmp ver 1.4.1)
curl -s http://127.0.0.1:3001/api/health | jq '.versions.appVersion'

# Check logs directory exists
ls -la /srv/cmp/backend/public/logos/

# Check backend logs
sudo journalctl -u cmp-backend -n 50 --no-pager

# Check if services are running
sudo systemctl status cmp-backend cmp-telegram-bot
```

## Installation Scripts Reference

### Fresh Installation
If you need to install from scratch, use the installation script:

```bash
# Download and run installer
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/install.sh -o install.sh
sudo bash install.sh
```

### Environment Variables
The installer will prompt for:
- Database credentials
- Admin username/password
- Backend port (default: 3001)
- Cloudflare credentials (for Let's Encrypt)
- Domain names

### Service Management
```bash
# Start services
sudo systemctl start cmp-backend cmp-telegram-bot

# Stop services
sudo systemctl stop cmp-backend cmp-telegram-bot

# Restart services
sudo systemctl restart cmp-backend cmp-telegram-bot

# Check status
sudo systemctl status cmp-backend
sudo systemctl status cmp-telegram-bot

# View logs
sudo journalctl -u cmp-backend -f
sudo journalctl -u cmp-telegram-bot -f
```

## Troubleshooting

### Logos Not Showing After Update
```bash
cd /srv/cmp/backend

# Check if logos directory exists
ls -la public/logos/

# If missing, restore from backup
node scripts/restore_logos.js

# Or manually copy from backup
cp -r /tmp/logos_backup_*/. public/logos/
```

### Services Not Starting
```bash
# Check logs for errors
sudo journalctl -u cmp-backend -n 100 --no-pager

# Check if port is already in use
sudo netstat -tulpn | grep 3001

# Verify database connection
cd /srv/cmp/backend
cat .env | grep DB_
```

### Database Issues
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test database connection
sudo -u postgres psql -c "SELECT version();"

# Check if database exists
sudo -u postgres psql -l | grep cmp
```

## Post-Deployment Checklist

- [ ] Version shows v1.4.1: `curl -s http://127.0.0.1:3001/api/health | jq '.versions.appVersion'`
- [ ] Backend service running: `sudo systemctl status cmp-backend`
- [ ] Telegram bot service running: `sudo systemctl status cmp-telegram-bot`
- [ ] Logos directory exists: `ls -la /srv/cmp/backend/public/logos/`
- [ ] Logo files present: `logo-70x70.png`, `logo-140x140.png`
- [ ] Website accessible via domain
- [ ] Can login as admin
- [ ] Activity logs working (Admin Panel → Activity Logs icon)
- [ ] Logos display correctly

## Rollback (If Needed)

```bash
cd /srv/cmp

# Rollback to previous version
git checkout v1.4.0  # or whatever previous version

# Rebuild frontend
cd frontend
npm run build

# Restore database from backup
sudo -u postgres psql cmp < /tmp/cmp_backup_YYYYMMDD_HHMMSS.sql

# Restart services
sudo systemctl restart cmp-backend cmp-telegram-bot
```

## Important Notes

1. **Logo Persistence**: Logos are now in `/srv/cmp/backend/public/logos/` - keep this directory backed up!
2. **Database Backups**: Always backup before updating
3. **Activity Logs**: New feature in v1.4.1 - automatically tracks account and user operations
4. **cert_status**: System cert checks are automatically excluded from activity logs
5. **Clear Logs**: Admins can now clear old activity logs via the UI

## Support

If you encounter issues:
1. Check service logs: `sudo journalctl -u cmp-backend -n 100`
2. Verify environment variables: `cat /srv/cmp/backend/.env`
3. Test database connection
4. Check logo files exist in `/srv/cmp/backend/public/logos/`
5. Restore from backup if needed
