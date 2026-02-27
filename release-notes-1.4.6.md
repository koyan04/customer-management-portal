# v1.4.6: Clean Update Process

## 🎯 Critical Update Fix

This release fixes the update process from v1.4.4/v1.4.5 to ensure zero errors during VPS updates.

## ✅ Update Process Improvements

### Migration Error Handling
- **update-vps.sh**: Now properly checks migration exit codes and fails update on errors
- Prevents silent failures where migrations error but update continues
- Rolls back services on migration failure

### Smart Schema Detection
- **run_migrations.js**: Detects existing installations by checking for core tables
- Skips base schema (000_schema.sql) on updates to prevent conflicts
- Eliminates "multiple primary keys" errors on existing tables
- Removes hundreds of "already exists" warnings during updates

## 🐛 Bug Fixes

- **Fixed**: "multiple primary keys for table 'admins_audit' are not allowed" error during updates
- **Fixed**: Update script continuing despite migration failures (exit code not checked)
- **Fixed**: Hundreds of "already exists" warnings cluttering update logs

## 🔧 Technical Changes

- Migration script now queries `information_schema.tables` to detect existing installation
- Base schema only applied on fresh installs (when users table doesn't exist)
- Individual migrations (019-021) still run on updates for new schema additions
- Update script now explicitly checks `node run_migrations.js` exit code

## 📦 Includes All Previous Features

- v1.4.5: Zero-error fresh installations (consolidated enabled column)
- v1.4.4: Memory management, certificate auto-fallback, financial fixes
- v1.4.3: Avatar backup/restore, auto-refresh persistence, permissions

## 🚀 Upgrade Instructions

### Update Existing VPS
```bash
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/update-vps.sh | sudo bash
```

**Expected Output:**
```
→ Running database migrations...
[migrate] Existing installation detected - skipping base schema
[migrate] applying 019-table-active_sessions.sql
[migrate] applying 020-table-server_keys_audit.sql
[migrate] applying 021-table-monthly_financial_snapshots.sql
  ✓ Migrations completed
```

### Fresh Install
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/bootstrap.sh | bash"
```

**Expected Output:**
```
→ Running database migrations...
Base 000_schema.sql applied successfully
[migrate] applying 019-table-active_sessions.sql
...
  ✓ Migrations completed
```

## 🔍 What Changed

### Before (v1.4.5)
- Update process tried to reapply base schema on existing installations
- Got "multiple primary keys" error at statement 111
- Migration completed with exit code 2 but update script ignored it
- Continued with errors, health check failed

### After (v1.4.6)
- Update process detects existing installation and skips base schema
- Only applies incremental migrations (019-021)
- Migration errors properly halt update process
- Clean, error-free updates

## 📝 Notes

- **Fresh installs**: Still apply complete base schema (no change in behavior)
- **Updates**: Now clean and fast (no redundant schema application)
- **Rollback**: If update fails, automatic service restart with rollback instructions
- **Idempotent**: Safe to run update multiple times

---

**Upgrade Recommended**: All v1.4.4 and v1.4.5 installations should update to v1.4.6 for clean future updates.
