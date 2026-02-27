## 🎯 Major Achievement: Zero-Error Fresh Installations

This release ensures **fresh installations complete without any migration errors or warnings**.

## ✅ Installation Improvements

- **Consolidated schema**: `enabled` column now in base users table (016-table-users.sql)
- **Removed redundancy**: Deleted migration 018-table-users-enabled.sql
- **Clean logs**: No more 'relation does not exist' or 'column does not exist' warnings

## 🐛 Bug Fixes

- Fixed 'relation users does not exist' error during fresh installs
- Fixed 'column enabled does not exist' warnings in migration logs  
- Migration script now properly exits on errors (caught by install scripts)

## 🔧 Technical Changes

- Added `enabled BOOLEAN DEFAULT TRUE NOT NULL` to users table definition
- Added `idx_users_enabled` index to base table schema
- Improved migration error handling with explicit `process.exit()`
- Consolidated migrations: 001 (admins+last_seen), 012 (servers+api_key), 016 (users+enabled), 021 (snapshots+server_id)

## 📦 Includes All 1.4.4 Features

- Automatic swap creation for low-memory VPS builds
- Auto HTTP-01 certificate fallback for third-party DNS (DynDNS, No-IP, etc.)
- Currency handling improvements (references global general settings)
- Properly consolidated migration architecture

## 🚀 Install/Upgrade

### Fresh Installation
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/bootstrap.sh | bash"
```

**Result**: Clean installation with zero errors ✅

### Update Existing Installation
```bash
curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/update-vps.sh | sudo bash
```

**Compatibility**: All migrations are idempotent - safe for existing installations ✅

---

**What's Changed**: Migration consolidation, error handling improvements  
**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.4.4...v1.4.5
