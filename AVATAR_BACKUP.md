# Avatar Backup Guide

## Overview
User profile photos (avatars) are stored in two locations:
1. **Database**: `admins` table columns `avatar_url` and `avatar_data`
2. **File System**: `backend/public/uploads/` directory

## Automated Backup (Telegram Bot)

The Telegram bot's backup now includes:
- ✅ Admins table data (including `avatar_url` and `avatar_data` columns)
- ❌ Physical avatar files in `/uploads/` directory (requires file system backup)

**Note**: The backup JSON file includes a note: `"Avatar files in public/uploads/ are not included - backup that directory separately"`

## Manual File System Backup

### On VPS
```bash
# Backup uploads directory
cd /srv/cmp/backend/public
tar -czf ~/avatar-backup-$(date +%Y%m%d).tar.gz uploads/

# Restore from backup
cd /srv/cmp/backend/public
tar -xzf ~/avatar-backup-YYYYMMDD.tar.gz
```

### Using update-vps.sh Script
The VPS update script automatically:
1. Backs up `/uploads/` to backup directory before update
2. Preserves `/uploads/` during file updates (not deleted during rsync)

## Restoration Process

### From Telegram Bot Backup
When you restore a Telegram bot backup (`.json`):
1. ✅ `avatar_url` and `avatar_data` are restored for matching admin usernames
2. ⚠️ If `avatar_url` points to a file in `/uploads/`, the file must exist
3. 🔧 Password hashes are NOT restored (security measure)

### Avatar Data Types
- **`avatar_url`**: Relative path like `/uploads/1738847291045-123456789.jpg` or absolute URL
- **`avatar_data`**: Base64-encoded image data (stored directly in database)

## Best Practices

1. **Regular Backups**: Set up automated file system backups of `/srv/cmp/backend/public/uploads/`
2. **Telegram Bot Backups**: Run periodically via bot commands to capture database state
3. **Pre-Update Backups**: Always backup before VPS updates (update-vps.sh does this automatically)
4. **Test Restores**: Periodically test restoration to ensure backups are valid

## Troubleshooting

### Missing Avatars After Restore
```bash
# Check if uploads directory exists
ls -la /srv/cmp/backend/public/uploads/

# Check database for avatar_url values
sudo -u postgres psql cmp -c "SELECT username, avatar_url FROM admins WHERE avatar_url IS NOT NULL;"

# Restore from backup
cd /srv/cmp/backend/public
tar -xzf /path/to/avatar-backup.tar.gz
```

### Avatars Not Showing
1. Verify file permissions: `chmod 644 /srv/cmp/backend/public/uploads/*`
2. Verify directory permissions: `chmod 755 /srv/cmp/backend/public/uploads/`
3. Check app.js serves static files from `/uploads/`
4. Check avatar_url in database matches actual file name

## Related Files
- `backend/routes/admin.js` - Avatar upload and restore logic
- `backend/telegram_bot.js` - Backup creation (includes admins table)
- `scripts/update-vps.sh` - Automated backup during updates
