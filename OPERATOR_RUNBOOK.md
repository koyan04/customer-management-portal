# Operator Runbook — Customer Management Portal

This runbook collects essential commands and short procedures for operators to manage deployments (Linux and Windows). Keep this file with your deployment docs and ensure only authorized operators have access.

Note: Replace `/srv/cmp` and `C:\srv\cmp` with your actual install paths.

## Fast checks

- Check backend health:

  Linux:
  ```bash
  curl -fsS https://your-domain/api/health | jq
  # or if HTTP
  curl -fsS http://127.0.0.1:3001/api/health | jq
  ```

  Windows (PowerShell):
  ```powershell
  Invoke-RestMethod -Uri http://localhost:3001/api/health
  ```

- Check service status (Linux systemd):
  ```bash
  sudo systemctl status cmp-backend.service
  sudo journalctl -u cmp-backend.service --since "1 hour ago" -e
  ```

- Check PM2 status (Windows or Linux with PM2):
  ```bash
  pm2 list
  pm2 logs --lines 200
  pm2 show cmp-backend
  ```

## Start/stop/restart

- Linux (systemd):
  ```bash
  sudo systemctl restart cmp-backend.service
  sudo systemctl restart cmp-telegram-bot.service   # if using the bot
  sudo systemctl status cmp-backend.service
  ```

- Windows (PM2):
  ```powershell
  pm2 restart cmp-backend
  pm2 save
  # If using pm2-windows-service, ensure pm2-service is running as a Windows service
  Get-Service -Name pm2* -ErrorAction SilentlyContinue
  ```

- Windows (nssm):
  ```powershell
  nssm restart cmp-backend
  nssm status cmp-backend
  ```

## Migrations

Run migrations from the backend folder. This runner is idempotent and will attempt to run sequentially.

```bash
cd /srv/cmp/backend
node run_migrations.js
```

If migration fails, inspect `backend/server.err` and the migration runner output. Use backups to restore if needed.

## Seeding (create admin / sample data)

```bash
cd /srv/cmp/backend
SEED_ADMIN_USERNAME=admin SEED_ADMIN_PASSWORD=admin123 node seedAdmin.js
node seedServers.js
node seedUsers.js
```

Security note: change seeded passwords immediately.

## Backups & restore (DB and config snapshots)

- Database dump (Postgres):
  ```bash
  # local Postgres
  PGPASSWORD=your_db_password pg_dump -h localhost -U cmp -Fc cmp > /var/backups/cmp_db_$(date +%F).dump
  # restore
  PGPASSWORD=your_db_password pg_restore -h localhost -U cmp -d cmp /var/backups/cmp_db_2025-11-14.dump
  ```

- Config snapshot (app_settings backup):
  The admin API provides config snapshot endpoints; prefer using the UI or admin API to create and download snapshots. To restore, use the admin restore endpoints or upload via the UI.

## Certificate renewal and hooks

- Linux (certbot + systemd): ensure certbot timer is enabled and that post-renew hook restarts backend.
  Example post-renew hook (executable script):
  ```bash
  #!/bin/bash
  systemctl restart cmp-backend.service
  ```

- Windows (win-acme): configure a post-renew script to restart the Windows service or run `nssm restart` / `pm2 restart`.

## Logs and troubleshooting

- Backend logs (default):
  - Check `server_err.log` and `server_out.log` in the backend working directory if using NSSM or PM2 redirection.
  - For systemd, use `journalctl -u cmp-backend.service -f`.

- Common checks:
  - Database connectivity: check `backend/.env` DB_* settings and test `psql` connection.
  - Verify `JWT_SECRET` present and long enough.
  - Check `backend/server.err` for stack traces and follow with `node index.js` in foreground for debugging.

## Emergency DB access (single-user mode)

If you must reset the postgres `postgres` user's password or start Postgres in single-user mode, follow PostgreSQL documentation for single-user mode and ensure backups are present before making changes.

## Rollback plan

1. If a migration causes severe issues, bring the service down: `sudo systemctl stop cmp-backend.service`.
2. Restore the DB from the last known-good dump:
   ```bash
   pg_restore -U cmp -d cmp /path/to/last_good.dump
   ```
3. Restart the service and verify health.

## Secrets rotation

- To rotate `JWT_SECRET`:
  1. Generate a new secret (32+ bytes) and place it in `backend/.env` as `JWT_SECRET`.
  2. Restart the backend service.
  3. Note: rotating JWT_SECRET invalidates existing tokens; coordinate with users.

## Useful one-liners

- Tail backend logs (systemd):
  ```bash
  journalctl -u cmp-backend.service -f
  ```

- Tail pm2 logs:
  ```bash
  pm2 logs --lines 200
  ```

- Dump recent DB errors from Postgres logs (log location depends on installation):
  ```bash
  sudo tail -n 200 /var/log/postgresql/postgresql-*.log
  ```

## Contact & escalation

- Maintain an on-call list for your operators and ensure at least one person can access the DB host and secret store.
- For critical incidents, collect these artifacts: backend logs, pm2 list output, systemd journal, DB dump (if safe), and timestamps for the incident window.

## Notes

This runbook is a concise set of operational commands tailored to this project; adapt paths and service names to your environment and embed additional organization-specific runbooks as needed.
