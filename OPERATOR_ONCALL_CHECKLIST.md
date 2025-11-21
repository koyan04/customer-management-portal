# On-call checklist — immediate incident actions

This one-page checklist is for on-call operators to follow during a production incident. Keep it handy (printer or pinned tab).

1) Triage & communicate
   - Note incident start time and affected services/endpoints.
   - Announce incident to on-call channel with severity and scope.
   - Assign an incident lead (single point of coordination).

2) Quick health checks (first 5 minutes)
   - Check service health endpoint:
     - Linux: curl -fsS https://your-domain/api/health
     - Windows/PowerShell: Invoke-RestMethod -Uri http://localhost:3001/api/health
   - Check process/service status:
     - systemd: sudo systemctl status cmp-backend.service
     - PM2: pm2 list && pm2 logs --lines 100
     - NSSM service: nssm status cmp-backend
   - Check recent error logs (tail last 200 lines):
     - systemd: sudo journalctl -u cmp-backend.service -n 200 --no-pager
     - pm2: pm2 logs --lines 200

3) If backend service is down or unresponsive
   - Restart service (note restart attempts):
     - Linux: sudo systemctl restart cmp-backend.service; sudo systemctl status cmp-backend.service
     - PM2: pm2 restart cmp-backend; pm2 save
     - NSSM: nssm restart cmp-backend
   - If restart fails, capture logs and increase severity.

4) Check database connectivity and errors
   - Test DB connection from app host:
     - psql -h <DB_HOST> -U <DB_USER> -d <DB_DATABASE>
   - Check recent DB logs for errors (location varies).
   - If DB is down or corrupted, escalate to DBA and prepare to restore from latest backup.

5) Restore plan (if DB restore is required)
   - Confirm restore is necessary and get approval from incident lead.
   - Put the app into maintenance mode (if applicable) or stop backend service: sudo systemctl stop cmp-backend.service
   - Restore DB from last known-good dump:
     - pg_restore -U <user> -d <db> /path/to/last_good.dump
   - Run migrations if needed and restart services.

6) Certificates & TLS failures
   - If TLS expired: check cert presence on disk and certbot/win-acme logs.
   - For Linux: sudo systemctl status certbot.timer; run certbot renew --dry-run
   - After renewal, restart backend service to pick up new certs.

7) Rollback code/deployments
   - If a recent deployment caused the issue, roll back to previous release and restart service.
   - Document the deployment that was reverted and notify stakeholders.

8) Post-incident actions (after service restored)
   - Capture timeline, root cause, and remediation steps in the incident report.
   - Create follow-up tickets for hygiene items (alerting, automation, regression tests).
   - Rotate any secrets or credentials that may have been exposed during recovery.

9) Contacts & escalation
   - Primary DBA: (add contact)
   - Primary backend dev: (add contact)
   - On-call manager: (add contact)

Keep this checklist accessible and update contacts/times as your on-call rota changes. Use the full `OPERATOR_RUNBOOK.md` for deeper procedures.
