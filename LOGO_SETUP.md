# Quick Start: Logo Persistence Setup

## Problem Fixed ✓
Logos now persist across database restores! They're stored separately from database data.

## What Changed

### Before
- Logos stored in `backend/public/uploads/` with random filenames
- Logo URLs in database pointed to these random filenames
- Database restore restored URLs but files were missing → broken logos

### After  
- Logos stored in `backend/public/logos/` with consistent filenames
- URLs always point to: `/logos/logo-70x70.png`, `/logos/favicon-32x32.png`, etc.
- Even after database restore, if files exist in `/logos/`, logos work!

## Quick Actions

### To Preserve Logos During Database Restore

**Before restore:**
```bash
cd backend
node scripts/backup_logos.js
```

**After restore:**
```bash
cd backend
node scripts/restore_logos.js
```

### To Manually Backup Logos
Just copy the directory:
```bash
# Windows PowerShell
Copy-Item -Recurse backend\public\logos backend\logo_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')

# Or manually copy backend\public\logos\ folder to a safe location
```

### After Fresh Install
Upload your logos through the Admin Panel → Settings → General Settings.
They'll automatically be stored in the persistent `/logos/` directory with consistent names.

## File Names (Consistent Across All Instances)
- `logo-70x70.png` - Main logo (standard resolution)
- `logo-140x140.png` - Logo for high-DPI screens  
- `favicon-32x32.png` - Browser tab icon
- `favicon-180x180.png` - Apple touch icon (iOS home screen)

## Important Directories

| Directory | Purpose | Backup? |
|-----------|---------|---------|
| `backend/public/logos/` | **PERSISTENT** logo storage | ✅ YES - Keep this! |
| `backend/public/uploads/` | Temporary user uploads | ❌ No (can be cleaned) |
| `backend/logo_backups/` | Logo backup archives | ✅ YES - For recovery |

## Best Practices

1. **After uploading new logo**: 
   ```bash
   cd backend
   node scripts/backup_logos.js
   ```

2. **Before database operations**:
   - Backup: `node scripts/backup_logos.js`
   - Or manually copy `backend/public/logos/` folder

3. **Server migration checklist**:
   - [ ] Copy `backend/public/logos/` directory
   - [ ] Copy `backend/logo_backups/` directory (optional, for safety)
   - [ ] After database restore, verify logos display
   - [ ] If missing, run `node scripts/restore_logos.js`

4. **Version control** (optional):
   Add to git if you want logos in your repository:
   ```bash
   # Remove from .gitignore
   git add backend/public/logos/
   git commit -m "Add persistent logos"
   ```

## Troubleshooting

### Logos not showing after database restore?

1. **Check if files exist:**
   ```bash
   ls backend/public/logos/
   ```

2. **If files missing, restore from backup:**
   ```bash
   cd backend
   node scripts/restore_logos.js
   ```

3. **If no backup exists:**
   - Re-upload logos through Admin Panel
   - They'll be automatically stored with consistent names
   - Create a backup: `node scripts/backup_logos.js`

### URLs still pointing to /uploads/?

This means you have old data. Run the migration script once:
```bash
cd backend
node scripts/migrate_logos.js
```

This will:
- Copy logo files from `/uploads/` to `/logos/`
- Rename them to consistent names
- Update database URLs to point to `/logos/`

## Summary

✅ **Logos now survive database restores** - stored separately from database  
✅ **Consistent file names** - easy to backup and restore  
✅ **Automated scripts** - backup and restore with one command  
✅ **No more broken logos** - after database operations

**Remember**: The `/logos/` directory is your permanent logo storage. Keep it safe!
