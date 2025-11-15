Production deployment notes for Telegram bot

Short summary
- The bot supports polling and is designed to read token/config from `app_settings` (settings_key = 'telegram').
- For production we recommend running the bot under a process supervisor (PM2 or systemd) and using a Postgres advisory lock so only one instance polls Telegram.
- A health endpoint is available at `/internal/bot/status` and Prometheus metrics at `/metrics`.
 - In user details, there is a "Refresh" button to re-fetch the latest info (works for active, soon, and expired users).

Recommended setup (PM2)
1. Install pm2 globally (on the server):
   npm install -g pm2

2. From the `backend` directory, start the bot with the provided ecosystem:
   pm2 start pm2.config.js --env production

3. To view logs:
   pm2 logs cmp-telegram-bot

4. To enable PM2 startup on system boot (example for systemd):
   pm2 startup systemd
   pm2 save

Token & settings management
- Store the bot token and default chat id using the Settings UI (Settings > Telegram Bot) or via the admin API (`PUT /api/admin/settings/telegram`). The bot reads `app_settings.telegram` and reloads every 60s.
- The bot writes `app_settings` row `telegram_bot_status` periodically so you can inspect recent status.

Quick local troubleshooting and verification
- Verify token and test-send a message (reads DB `app_settings.telegram`):
   - From the repository root run:
      ```powershell
      cd backend
      node scripts/verify_telegram.js
      ```
      This calls Telegram's `getMe` and sends a small test message to the configured default chat id.
- Read the latest bot status written to the DB:
   - From the repository root run:
      ```powershell
      node backend/scripts/read_bot_status.js
      ```
      (This prints the `telegram_bot_status` row if present.)

User interactions overview
- Main menu shows server list and quick access to Soon/Expired users.
- Server -> User flow: selecting a user opens a detail view with buttons:
   - "Refresh" to reload the user's status and expiry.
   - "Change Expire Date" to extend by 1/2/6 months.
   - "Back to Server" to return to the user list.

Common issues
- 401 Unauthorized from Telegram (getUpdates / getMe)
   - Cause: the stored token is incorrect, expired, or stored under a different key name. Our verification helper reads `botToken` or `token` in the `app_settings.telegram` JSON; the running bot was previously only checking `token` which can cause a mismatch if the token was stored under `botToken` (this has been fixed). If you still see 401, re-enter the token in Settings and re-run the verify script.
- Bad Request: chat not found when sending test message
   - Cause: the test recipient (default chat id) hasn't started the bot or the chat id is incorrect. Ask the user to open the bot in Telegram (tap /start) and re-run the verify script.
- Metrics / health endpoint unreachable
   - Cause: the backend web server must be running to expose `/metrics` and `/internal/bot/status`. Start the backend (`node index.js` or your usual start command) and ensure Prometheus scrapes the correct host/port.

High-availability notes
- Use 2+ application instances for the web app, but run the bot under PM2 on a single dedicated instance. The code also implements a Postgres advisory lock so multiple app instances can run the bot code but only one will acquire the lock and poll Telegram.
- For webhook mode (recommended to avoid polling), you can run a single instance behind HTTPS and set the webhook URL with Telegram. This code currently uses polling; we can add an optional webhook mode if desired.

Monitoring
- Prometheus metrics available at `/metrics`. The custom gauge `cmp_telegram_bot_up` is 1 when the bot has a recent successful poll, 0 otherwise.
- Add a scrape job to your Prometheus configuration to scrape the backend service.

Security
- Keep the bot token in `app_settings.telegram` or a secrets manager; the UI masks it and audit entries are recorded on change. Use the reveal endpoint only when necessary.

If you want, I can:
- Add webhook mode to the bot and example HTTPS setup (nginx + certbot) and a small guide to switch to webhooks.
- Provide a systemd unit file example instead of PM2.

Webhook mode (optional)
- You can run the bot via Telegram webhooks instead of long polling. Set these environment variables and restart the backend:
   - `USE_WEBHOOK=true`
   - `WEBHOOK_URL=https://your-public-hostname` (the bot will append a safe path automatically)
   - Optional: `WEBHOOK_PORT=3002` and `WEBHOOK_PATH=/custom/path`
- In webhook mode, the bot will start an Express receiver and will NOT start the getUpdates polling loop (to prevent 409 conflicts).
- To revert back to polling, unset `USE_WEBHOOK` and restart.

Troubleshooting 409 conflicts
- If you see repeated `409 Conflict` on getUpdates, it usually means another instance of the bot is running with the same token, or a webhook is set while polling is enabled.
- Fixes:
   1) Ensure only a single instance is running (stop duplicate PM2 or other processes), or set `START_TELEGRAM_BOT=false` in `backend/.env` to prevent the web app from starting the bot.
   2) If switching to webhooks, set `USE_WEBHOOK=true` (the bot will skip polling) and make sure `WEBHOOK_URL` is reachable over HTTPS.
   3) The bot now attempts `deleteWebhook` automatically if a 409 indicates a webhook conflict; you can also run `node backend/scripts/verify_telegram.js` to inspect token health.
