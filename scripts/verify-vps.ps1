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
systemctl is-active cmp-telegram-bot
echo ""
echo "→ API Health Check:"
curl -s http://127.0.0.1:3001/api/health | grep -o '"appVersion":"[^"]*"' | cut -d'"' -f4
echo ""
echo "→ Recent Logs (last 5 lines):"
journalctl -u cmp-backend -n 5 --no-pager
"@
