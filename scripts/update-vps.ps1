# VPS Update Script - Uses tarball method to update to latest release
# Usage: .\update-vps.ps1

$VPS_IP = "167.71.200.239"
$SSH_KEY = "C:\Users\Ko Yan\projects\vc-opsh"
$VPS_USER = "root"
$SCRIPT_PATH = Join-Path $PSScriptRoot "update-vps.sh"

Write-Host "=== VPS Update Script - Tarball Method ===" -ForegroundColor Cyan
Write-Host "Target: $VPS_USER@$VPS_IP" -ForegroundColor Yellow
Write-Host ""

# Verify SSH key exists
if (-not (Test-Path $SSH_KEY)) {
    Write-Host "ERROR: SSH key not found at: $SSH_KEY" -ForegroundColor Red
    exit 1
}

# Verify update script exists
if (-not (Test-Path $SCRIPT_PATH)) {
    Write-Host "ERROR: Update script not found at: $SCRIPT_PATH" -ForegroundColor Red
    exit 1
}

Write-Host "Step 1: Uploading update script to VPS..." -ForegroundColor Green
scp -i $SSH_KEY $SCRIPT_PATH "$VPS_USER@${VPS_IP}:/tmp/update-cmp.sh"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to upload script" -ForegroundColor Red
    exit 1
}

Write-Host "Step 2: Making script executable..." -ForegroundColor Green
ssh -i $SSH_KEY "$VPS_USER@$VPS_IP" "chmod +x /tmp/update-cmp.sh"

Write-Host "Step 3: Executing update on VPS..." -ForegroundColor Green
Write-Host ""

# Execute the update script
ssh -i $SSH_KEY -t "$VPS_USER@$VPS_IP" "/tmp/update-cmp.sh"

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "=== Update Successful ===" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Test the application at your domain" -ForegroundColor White
    Write-Host "2. Check logs if needed:" -ForegroundColor White
    Write-Host "   ssh -i `"$SSH_KEY`" $VPS_USER@$VPS_IP 'journalctl -u cmp-backend -n 50'" -ForegroundColor Gray
    Write-Host "3. Verify Telegram bot is working" -ForegroundColor White
} else {
    Write-Host "=== Update Failed ===" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check the error messages above." -ForegroundColor Yellow
    Write-Host "To troubleshoot:" -ForegroundColor Yellow
    Write-Host "  ssh -i `"$SSH_KEY`" $VPS_USER@$VPS_IP" -ForegroundColor Gray
}

Write-Host ""


