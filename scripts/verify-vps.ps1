# VPS Verification Script
$VPS_IP = "167.71.200.239"
$SSH_KEY = "C:\Users\Ko Yan\projects\vc-opsh"
$VPS_USER = "root"

Write-Host "=== VPS Status Check ===" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking version and services..." -ForegroundColor Green
ssh -i $SSH_KEY "$VPS_USER@$VPS_IP" @"
echo "→ Installed Version:"
cat /srv/cmp/VERSION
echo ""
echo "→ Backend Service Status:"
systemctl is-active cmp-backend
echo ""
echo "→ Telegram Bot Status:"
echo "  (runs inside cmp-backend under a Postgres advisory lock)"
if systemctl is-active cmp-telegram-bot >/dev/null 2>&1; then
  echo "  WARNING: a standalone cmp-telegram-bot unit is ACTIVE."
  echo "  This creates a second poller and causes HTTP 409 getUpdates conflicts."
  echo "  Fix: systemctl disable --now cmp-telegram-bot && systemctl mask cmp-telegram-bot"
else
  echo "  OK: no duplicate poller (expected)"
fi
echo ""
echo "→ Bot poller health (from cmp-backend logs):"
journalctl -u cmp-backend -n 200 --no-pager | grep -c "acquired advisory lock" | sed 's/^/  advisory lock events: /'
journalctl -u cmp-backend -n 200 --no-pager | grep -c "terminated by other getUpdates" | sed 's/^/  HTTP 409 conflicts: /'
echo ""
echo "→ API Health Check:"
curl -s http://127.0.0.1:3001/api/health | grep -o '"appVersion":"[^"]*"' | cut -d'"' -f4
echo ""
echo "→ Recent Logs (last 5 lines):"
journalctl -u cmp-backend -n 5 --no-pager
"@
