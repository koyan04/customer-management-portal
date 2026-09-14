# Release Notes

> For release assets and full changelogs, visit [GitHub Releases](https://github.com/koyan04/customer-management-portal/releases).

---

cmp ver 1.9.23

What's new
- Trojan WS/TLS `ws closed 1000` Fix: resolved handshake disconnects in Clash Mi by automatically decoding double/triple percent-encoded passwords to ensure correct SHA224 hashing, locking WS ALPN to `[http/1.1]` (preventing unsupported h2 negotiation on port 80/CDN), and ensuring `skip-cert-verify: true` is emitted in YAML
- VLESS REALITY Authentication Fix: resolved `REALITY authentication failed` in Clash Mi / Mihomo by explicitly syncing both `sni` and `servername` to the reality target domain (e.g., `www.goo.gl`), and ensuring `public-key` and `short-id` are serialized as quoted string scalars in `reality-opts`
- VLESS XHTTP Parameters: added `Host` header and `x-padding-bytes: "100-1000"` to `xhttp-opts` matching working sing-box/xray configurations
- Key Server Auto-Healing Engine: updated `sanitizeClashYaml` to repair Trojan passwords, ALPN, skip-cert-verify, and REALITY SNI on the fly for all configs served from `/sub/:id` or saved to the server

See [Release v1.9.23](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.23) for full details.

---

cmp ver 1.9.22

What's new
- Clash Rules Proxy Target Unquoting Fix: resolved `error: proxy ["🚀 VChannel-Premium"] not found` in Clash Mi and Mihomo caused by quotes being added to proxy targets in `rules:` comma-separated entries
- Clean Rules Generation: updated YAML Generator to keep target group names unquoted in the `rules:` section (e.g., `- DOMAIN-SUFFIX,netflix.com,🚀 VChannel-Premium`), aligning strictly with the Clash/Mihomo rule specification
- Backend Auto-Sanitizer for Rules: updated Key Server's `sanitizeClashYaml` to automatically strip any enclosing double or single quotes from rule targets on the fly when served or saved

See [Release v1.9.22](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.22) for full details.

---

cmp ver 1.9.21

What's new
- Key Server Clash YAML Sanitizer Fix: resolved `yaml: line 4: did not find expected key` and bad indentation errors in Clash Mi and Mihomo caused by the sanitizer replacing `proxies:` with `proxies: []` even when proxy nodes were present
- Auto-Healing YAML Engine: updated `sanitizeClashYaml` to intelligently check for proxy items before applying `proxies: []`, while automatically repairing previously corrupted `proxies: []` blocks back to clean `proxies:` on the fly when served or saved
- Comprehensive YAML Spec Tests: added unit tests with `js-yaml` validating syntax compliance and automatic healing of corrupted subscription configurations

See [Release v1.9.21](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.21) for full details.

---

cmp ver 1.9.20

What's new
- YAML Proxy Name Quoting Fix: fixed `yaml: line 4: did not find expected key` error in Clash Mi (and other strict YAML parsers) caused by unquoted proxy names and group names containing special characters (parentheses, emoji, colons) in `proxy-groups` proxies lists and `rules` section
- Added `qn()` quoting helper in YAML Generator that wraps all proxy/group name scalars in double-quoted strings with proper escape handling, ensuring full YAML spec compliance for all generated configs

See [Release v1.9.20](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.20) for full details.

---

cmp ver 1.9.19

What's new
- Clash YAML Configuration & Mihomo Validation Fix: fixed `proxy group[0]: 🛡️ Failover: 'use' or 'proxies' missing` error in Clash Verge Rev when generating or serving subscription keys
- Proxy Group Guardrails: ensured empty/null proxy groups (Auto Switch, Fastest, Failover, Load Balance) are omitted when 0 active nodes are configured, maintaining valid Clash specification syntax (`proxies: []` and `DIRECT` selector)
- Generator Validation & UX Alerts: added validation in YAML and JSON Generators preventing accidental saving of empty proxy configs to Key Server, along with prominent warning cards in the UI
- Key Server YAML Auto-Sanitizer: added backend sanitization on upload and on `/sub/:id` serving to self-heal existing configs for seamless Clash Verge Rev compatibility

See [Release v1.9.19](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.19) for full details.

---

cmp ver 1.9.18

What's new
- Slide-Over Panel Stacking & Portal Layering Fix: portaled `ServerMonitorSlideOver` directly into `document.body` via `createPortal` with `z-index: 99999`, fixing navbar elements rendering across the slide-over panel
- Modal Stacking Context Polish: removed artificial `z-index` from `.main-content` and elevated `.modal-backdrop` to `z-index: 10000`

See [Release v1.9.18](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.18) for full details.

---

cmp ver 1.9.17

What's new
- Update Script DB Backup Hardening: fixed update scripts (`update-vps.sh` and `update-unattended.sh`) freezing on "Backing up database..."; added `-w` (no password prompt), `PGCONNECT_TIMEOUT=5`, `--lock-wait-timeout=10000`, process timeout wrapper, and automated credential resolution from `backend/.env` with multi-tier fallback
- Navbar Dropdown Z-Index Stacking Context Fix: added proper stacking contexts (`z-index: 1000` on `.main-header`, `z-index: 1` on `.main-content`) preventing avatar and key dropdown popovers from being clipped behind action buttons

See [Release v1.9.17](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.17) for full details.

---

cmp ver 1.9.16

What's new
- Server Monitor Slide-Over Panel: real-time host telemetry monitor on the Dashboard tracking CPU, RAM, SWAP, Storage, Network I/O, Sockets, Uptime, Process Memory, and Server IP
- Full Theme Adaptation: slide-over panel, sparklines, and dual-line charts dynamically adapt to dark mode and light mode in real time
- Interactive Telemetry Controls: pause/resume toggle, custom polling interval (2s, 5s, 10s), manual refresh, CMP backend restart, and live systemctl logs viewer
- Navbar Menus UI/UX Bug Fixes: fixed avatar menu animation jump glitch, added complete light theme support for avatar dropdown, unified button sizing/alignment, added active indicator for generator routes, eliminated hover gap flickers, and improved mobile responsiveness

See [Release v1.9.16](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.16) for full details.

---

cmp ver 1.9.15

What's new
- Update & Swap Mechanism Hardening: fixed live unattended updates failing with `dd: IO error: No space left on device` on low-memory servers where /tmp is a tmpfs RAM disk
- Proactive Stale Swap Cleanup: update scripts and backend automatically detect, swapoff, and remove stale swap files across /tmp, /var/tmp, and /srv/cmp, self-healing servers with full /tmp
- Disk-Backed Swap Selection: temporary build swap strictly avoids tmpfs/ramfs, selects persistent disk partitions with sufficient headroom, and sizes swap dynamically (1536MB, 1024MB, 512MB)
- Existing Swap Detection: skips temporary swap creation if the server already has >= 1GB free swap
- Robust Cleanup Traps: EXIT/INT/TERM traps ensure temporary swap files are always cleanly deactivated and removed even if a build fails or is interrupted
- Container & Privilege Fallbacks: gracefully continues with conservative memory settings if swapon is restricted in containers (Docker, LXC)

See [Release v1.9.15](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.15) for full details.

---

cmp ver 1.9.14

What's new
- Server uninstaller: added scripts/uninstall.sh that cleanly removes the portal (systemd units/timers, Nginx vhosts, Let's Encrypt certs, Cloudflare creds, /srv/cmp, and optionally the PostgreSQL role+DB) with confirmation, --dry-run, --keep-* and --yes options
- Docs: added an Uninstall section to README.md and VPS_DEPLOYMENT.md

See [Release v1.9.14](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.14) for full details.

---

cmp ver 1.9.13

What's new
- Key Server HTTPS: installer now issues a certificate for the key server domain and writes a proper HTTPS vhost (with HTTP→HTTPS redirect); fixes HTTPS requests falling through to the portal React app
- Key Server Live Secret Key: automatically reads key_server_secret from app_settings on each request
- Install Script Polish: fixed subshell command substitution formatting, corrected default prompt options, and ensured Linux LF line endings

See [Release v1.9.13](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.13) for full details.

---

cmp ver 1.9.12

What's new
- Financial Snapshots: monthly auto-snapshot now performs a startup catch-up so a missed month-end snapshot gets generated automatically after restart
- Financial page: "Current" month status now uses the app timezone, so the correct month is labeled instead of the previous one
- Nav bar generator menu: clicking Key Manager / YAML Generator / JSON Generator no longer leaks the click and re-collapses the menu

See [Release v1.9.12](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.12) for full details.

---

cmp ver 1.9.11

What's new
- Hide Disabled Users: New checkbox under Settings → General (default on) hides disabled users from the server user list and dashboard tier modal; disabled accounts remain visible via the Disabled status filter
- Key Manager: Fixed mobile action menu so clicks no longer leak through to underlying rows or page elements

See [Release v1.9.11](https://github.com/koyan04/customer-management-portal/releases/tag/v1.9.11) for full details.

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

See [Release v1.5.0](https://github.com/koyan04/customer-management-portal/releases/tag/v1.5.0) for full details.

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
