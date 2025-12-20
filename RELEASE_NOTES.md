cmp ver 1.4.1

What's new
- Activity Logs: Comprehensive audit logging for account and user operations with filtering and clear logs functionality
- Logo Persistence: Logos now stored in dedicated `/logos/` directory and survive database restores with backup/restore scripts
- Financial Report: Fixed filtering for SERVER_ADMIN users with proper server permission tracking
- UI Improvements: Enhanced action button styling with circular design and better color scheme (purple/blue/red)

Key Features
- Activity logs modal shows Action, Object (user/account), Server, and Date & Time in DD/MM/YYYY format
- Clear Logs button to remove old activity records
- Persistent logo storage in `backend/public/logos/` with consistent naming (logo-70x70.png, etc.)
- Backup scripts: `backup_logos.js`, `restore_logos.js`, `migrate_logos.js`
- Automatic exclusion of system operations (cert_status) from activity logs

Verification
- Backend health and version (should show `cmp ver 1.4.1`): curl -s http://127.0.0.1:3001/api/health | jq '.versions.appVersion'
- Activity logs: Login as admin → Admin Panel → Click activity logs icon for any account
- Logo persistence: Check `backend/public/logos/` directory exists with consistent file names
- Financial filtering: Login as SERVER_ADMIN user and verify financial data displays correctly

CI / Tests
- Frontend tests (Vitest) and backend tests (Jest) passed locally in this workspace.

Upgrade Notes
- For existing installations with logos: run `node backend/scripts/migrate_logos.js` to migrate to new persistent storage
- Backup logos before database restore: `node backend/scripts/backup_logos.js`
- Restore after database restore: `node backend/scripts/restore_logos.js`
- Seed server permissions for existing SERVER_ADMINs: `node backend/seedServerAdminPerms.js`

Notes
- Tag `v1.4.1` includes activity logs, logo persistence, and financial report fixes.
- See `LOGO_SETUP.md` and `backend/LOGO_PERSISTENCE.md` for detailed logo management documentation.

