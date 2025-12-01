cmp ver 1.3.0

What's new
- User transfer: added a "Transfer user" section in the Servers list UI allowing server admins and global admins to move users between servers from the server list view.
- Timezone preview: the General settings tab now shows the current date/time for the selected timezone to help choose and confirm the timezone.
- Telegram bot: periodic report time is now linked to the app timezone setting so scheduled messages respect the configured timezone.
- Financial page: modified monthly report table for improved readability and timezone-aware month headings.
- Visual polish: assorted UI and accessibility improvements across server list, settings, and financial pages.

Verification
- Backend health and version (should show `cmp ver 1.3.0`): curl -s http://127.0.0.1:3001/api/health | jq '.versions.appVersion'
- Telegram bot status: curl -s http://127.0.0.1:3001/internal/bot/status | jq
- Frontend checks: Settings  General (timezone preview), Servers  Server list (Transfer user control), Financial page (monthly report table)

CI / Tests
- Frontend tests (Vitest) and backend tests (Jest) were run locally and passed in this workspace.

Notes
- Tag `v1.3.0` now points at the commit included in this repo. Overwriting the remote tag was done by request.
