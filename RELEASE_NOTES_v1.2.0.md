# Release Notes v1.2.0

**Release Date**: 2025-01-XX

## 🔧 Critical Fixes

### Backup/Restore System Complete Overhaul

This release addresses critical data loss issues in the backup and restore system. All backup mechanisms have been enhanced to include complete data.

#### What Was Fixed

1. **Complete User Data in Backups**
   - Previously missing fields: `contact`, `total_devices`, `data_limit_gb`, `remark`, `display_pos`, `created_at`
   - Now included in all backup formats (Telegram snapshot, Settings/Database backup)

2. **Key Management Data in Backups**
   - `server_keys` table was completely missing from backups
   - Now includes all fields: `id`, `server_id`, `username`, `description`, `original_key`, `generated_key`, `created_at`

3. **Duplicate Conflict Handling in Restore**
   - Restore would fail with "duplicate key value violates unique constraint users_server_account_unique_idx"
   - Now checks for existing `(server_id, account_name)` before insert
   - Updates existing user if found with different ID
   - Prevents restore failures on duplicate account names

4. **Automatic Database Sequence Reset**
   - Sequence out-of-sync caused "duplicate key" errors when adding new users
   - Migration system now automatically resets all sequences (`users_id_seq`, `servers_id_seq`, `admins_id_seq`, etc.)
   - Sequences sync to `MAX(id) + 1` after migrations

### Fixed Endpoints

#### Backend API Changes

**telegram_bot.js** (Line 990-1000)
```javascript
// OLD: Only 5 user fields
SELECT id, server_id, account_name, service_type, expire_date FROM users

// NEW: All 11 user fields + server_keys
SELECT id, server_id, account_name, service_type, contact, expire_date, 
       total_devices, data_limit_gb, remark, display_pos, created_at FROM users
SELECT id, server_id, username, description, original_key, generated_key, 
       created_at FROM server_keys
```

**admin.js - GET /backup/snapshot** (Line 1327)
- Added `server_keys` table to snapshot JSON
- Added all missing user fields

**admin.js - GET /backup/db** (Line 1287-1310)
- Added `users` table with complete fields
- Added `server_keys` table with complete fields

**admin.js - POST /restore/snapshot** (Line 1424-1450)
- Added duplicate conflict checking
- Checks existing `(server_id, account_name)` before insert
- Updates existing user if ID differs
- Prevents restore failures

**run_migrations.js**
- Added automatic sequence reset after migrations
- Resets: `users_id_seq`, `servers_id_seq`, `admins_id_seq`, `server_keys_id_seq`, etc.

## 🚀 Installation

### Fresh Installation

```bash
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/install.sh | bash
```

The installer will automatically download v1.2.0 from GitHub releases.

### Upgrade from Previous Versions

#### Option 1: Via Install Script (Recommended)

```bash
# Download and run installer
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/install.sh | bash

# Restart backend
sudo systemctl restart cmp-backend
```

#### Option 2: Manual File Update (Quick Fix)

If you need only the admin.js fix:

```bash
# Download fixed admin.js
cd /srv/cmp/backend/routes
sudo wget https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.2.0/backend/routes/admin.js -O admin.js

# Restart backend
sudo systemctl restart cmp-backend
```

### Verify Installation

```bash
# Check backend version in logs
sudo journalctl -u cmp-backend -n 20

# Test backup endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/backup/snapshot

# Check if backup includes server_keys
```

## ⚠️ Important Notes

### Data Loss in Previous Versions

**If you created backups before v1.2.0, they may be incomplete:**

1. **User data missing**: `contact`, `total_devices`, `data_limit_gb`, `remark`, `display_pos`
2. **Key Management missing**: All `server_keys` data (generated SSH keys)

**Recommended Action**: Create a fresh backup immediately after upgrading to v1.2.0.

### Backup Compatibility

- Old backups (pre-v1.2.0) can still be restored
- Missing fields will be set to defaults
- `server_keys` will not be restored from old backups (manual re-creation required)

### Restore Behavior Changes

- Restore now handles duplicate `(server_id, account_name)` by updating existing users
- This prevents restore failures but may overwrite existing data
- Review users after restore to ensure data integrity

## 🔍 Testing

### Test Backup Completeness

1. Create a backup via Settings → Database → Backup
2. Download `cmp-backup.json`
3. Verify it contains:
   - `users` array with all fields (contact, total_devices, data_limit_gb, remark, display_pos)
   - `server_keys` array with all keys

### Test Restore Duplicate Handling

1. Create a user: Server A, Account "test123"
2. Create backup
3. Change user ID in database (simulate conflict)
4. Restore backup
5. Verify: User updated, no "duplicate key" error

### Test Sequence Reset

1. Run migrations: `node backend/run_migrations.js`
2. Check logs for "Sequence reset complete"
3. Try adding new user via UI
4. Verify: No "duplicate key" error

## 📋 Checklist for Operators

After upgrading to v1.2.0:

- [ ] Verify backend service restarted successfully
- [ ] Create a fresh backup via Settings → Database
- [ ] Download and verify backup contains `server_keys`
- [ ] Test restore on development/staging environment
- [ ] Document any custom keys that need manual backup
- [ ] Update backup schedule documentation

## 🐛 Known Issues

None reported yet.

## 📚 Related Documentation

- [Operator Runbook](OPERATOR_RUNBOOK.md)
- [Database Backup Guide](backend/README.md#database-backups)
- [Telegram Bot Setup](backend/README_TELEGRAM_BOT.md)

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.
