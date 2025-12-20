# Logo Persistence Guide

## Overview
Logos and favicons are now stored in a persistent directory (`backend/public/logos/`) separate from regular uploads. This ensures logos survive database restores.

## How It Works

### Storage Location
- **Logos**: `backend/public/logos/`
  - `logo-70x70.png` - Main logo (1x)
  - `logo-140x140.png` - High-DPI logo (2x)
  - `favicon-32x32.png` - Browser favicon
  - `favicon-180x180.png` - Apple touch icon

### Key Features
1. **Consistent naming**: Logos use fixed filenames, not timestamps
2. **Persistent directory**: Files stored in `/logos/` instead of `/uploads/`
3. **Backup/Restore**: Scripts available for backing up and restoring logos

## Usage

### Before Database Restore
Backup your logos to prevent loss:
```bash
cd backend
node scripts/backup_logos.js
```

This creates a timestamped backup in `backend/logo_backups/`.

### After Database Restore
If logos are missing after database restore, run:
```bash
cd backend
node scripts/restore_logos.js
```

This restores logos from the most recent backup.

### Manual Backup
You can also manually copy the logos directory:
```bash
# Windows
xcopy backend\public\logos backend\logo_backups\logos_manual /E /I

# Linux/Mac
cp -r backend/public/logos backend/logo_backups/logos_manual
```

## Troubleshooting

### Logos Not Displaying
1. Check if logo files exist:
   ```bash
   ls backend/public/logos/
   ```

2. Check database settings:
   ```sql
   SELECT data->'logo_url', data->'favicon_url' 
   FROM app_settings 
   WHERE settings_key = 'general';
   ```

3. If files exist but URLs are wrong, re-upload the logo through the admin panel

4. If files are missing but URLs exist in database, restore from backup:
   ```bash
   node scripts/restore_logos.js
   ```

### Creating a New Backup
It's recommended to backup logos:
- Before database restore
- After uploading new logos
- Before server migration

```bash
node scripts/backup_logos.js
```

## Migration Notes

When moving to a new server:
1. Backup logos: `node scripts/backup_logos.js`
2. Copy entire `backend/logo_backups/` directory to new server
3. After database restore on new server, run: `node scripts/restore_logos.js`

## Directory Structure
```
backend/
├── public/
│   ├── logos/              # Persistent logo storage (keep this!)
│   │   ├── logo-70x70.png
│   │   ├── logo-140x140.png
│   │   ├── favicon-32x32.png
│   │   └── favicon-180x180.png
│   └── uploads/            # Temporary uploads (can be cleaned)
└── logo_backups/           # Logo backups (keep for restore)
    ├── logos_2025-12-20T13-30-00/
    └── logos_2025-12-21T10-15-00/
```

## Best Practices

1. **Regular Backups**: Run `backup_logos.js` before any database operations
2. **Version Control**: Consider adding `backend/public/logos/` to git (optional)
3. **Exclude from Gitignore**: If you want logos in version control, exclude from `.gitignore`
4. **Server Migration**: Always copy `logo_backups/` directory when migrating servers
