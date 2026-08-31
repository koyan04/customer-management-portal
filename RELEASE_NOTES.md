cmp ver 1.9.14

What's new
- Server uninstaller: added scripts/uninstall.sh that cleanly removes the portal (systemd units/timers, Nginx vhosts, Let's Encrypt certs, Cloudflare creds, /srv/cmp, and optionally the PostgreSQL role+DB) with confirmation, --dry-run, --keep-* and --yes options
- Docs: added an Uninstall section to README.md and VPS_DEPLOYMENT.md

See release-notes-1.9.14.md for full details.

---

cmp ver 1.9.13

What's new
- Key Server HTTPS: installer now issues a certificate for the key server domain and writes a proper HTTPS vhost (with HTTP→HTTPS redirect); fixes HTTPS requests falling through to the portal React app
- Key Server live secret key: /sub/:id now reads keyserver.json per-request, so secret key / config dir updates take effect immediately without a backend restart
- Installer UI polish: color banner, section headers, and ✔ status markers; fixed mojibake text
- Installer line-ending fix: shell scripts normalized to LF and enforced via .gitattributes (prevents bash $'\r' errors)

See release-notes-1.9.13.md for full details.

---

cmp ver 1.9.12

What's new
- Financial Snapshots: monthly auto-snapshot now performs a startup catch-up so a missed month-end snapshot gets generated automatically after restart
- Financial page: "Current" month status now uses the app timezone, so the correct month is labeled instead of the previous one
- Nav bar generator menu: clicking Key Manager / YAML Generator / JSON Generator no longer leaks the click and re-collapses the menu

See release-notes-1.9.12.md for full details.

---

cmp ver 1.9.11

What's new
- Hide Disabled Users: New checkbox under Settings → General (default on) hides disabled users from the server user list and dashboard tier modal; disabled accounts remain visible via the Disabled status filter
- Key Manager: Fixed mobile action menu so clicks no longer leak through to underlying rows or page elements

See release-notes-1.9.11.md for full details.

---

cmp ver 1.5.0

What's new
- Domain Manager: Full CRUD management for proxy domains with CDN and Anti-DPI flags
- Key Manager: Subscription key management with search, pagination, batch delete, and import
- YAML Generator: Clash/Meta proxy config generator with multi-node support and text export
- JSON Generator: sing-box proxy config generator with multi-node support and text export
- Key Server: Subscription config serving with auto sing-box to base64 URI conversion for V2Box/Xray
- Admin Backup & Restore: Full admin account backup including profiles, audit logs, and permissions
- Export Nodes as Text: Download active nodes as plain text proxy URI file from both generators
- Navbar positioning improved for desktop layout

See release-notes-1.5.0.md for full details.

---

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

