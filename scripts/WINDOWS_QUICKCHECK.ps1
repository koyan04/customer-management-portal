<#
WINDOWS_QUICKCHECK.ps1

Quick post-install verification for Customer Management Portal on Windows.

Usage (Admin PowerShell):
    Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
    .\scripts\WINDOWS_QUICKCHECK.ps1 -InstallDir C:\srv\cmp

Checks performed:
- node and npm versions
- psql availability and version
- backend/.env presence and DB_* entries
- pm2 availability and process list for cmp-backend
- backend health endpoint (uses DOMAIN_NAME or localhost:PORT)

Exits with code 0 if all critical checks pass, 1 otherwise.
#>

param(
    [string]$InstallDir = "C:\\srv\\cmp",
    [int]$HttpTimeoutSec = 10
)

function Write-Stamp($msg) { Write-Output "[$(Get-Date -Format o)] $msg" }

$errors = @()

Write-Stamp "Quickcheck started. InstallDir=$InstallDir"

Write-Stamp "Checking Node..."
try {
    $node = & node --version 2>$null
    $npm = & npm --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $node) { $errors += 'node/npm not found' } else { Write-Output "node: $node, npm: $npm" }
} catch { $errors += 'node/npm check failed' }

Write-Stamp "Checking psql..."
try {
    $psql = & psql --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $psql) { $errors += 'psql not found' } else { Write-Output "$psql" }
} catch { $errors += 'psql check failed' }

Write-Stamp "Checking backend .env..."
$envFile = Join-Path -Path (Join-Path -Path $InstallDir -ChildPath 'backend') -ChildPath '.env'
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -ErrorAction SilentlyContinue
    $dbLines = $envContent | Where-Object { $_ -match '^(DB_HOST|DB_PORT|DB_DATABASE|DB_USER|DB_PASSWORD)=' }
    if ($dbLines.Count -lt 5) { $errors += 'backend/.env missing DB_* entries' } else { Write-Output "backend/.env seems to contain DB_* entries" }
} else { $errors += 'backend/.env not found' }

Write-Stamp "Checking PM2 and processes..."
try {
    $pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
    if (-not $pm2) { $errors += 'pm2 not installed' } else {
        Write-Output "pm2 found: $($pm2.Source)"
        $list = & pm2 list 2>&1
        if ($LASTEXITCODE -ne 0) { Write-Output $list; $errors += 'pm2 list failed' } else { Write-Output $list }
        # check if cmp-backend is in list
        if ($list -match 'cmp-backend' -or $list -match 'cmp-backend') { Write-Output 'cmp-backend appears in pm2 list' } else { Write-Output 'cmp-backend not found in pm2 list (may be named differently)'; $errors += 'cmp-backend not registered in pm2' }
    }
} catch { $errors += 'pm2 check failed' }

Write-Stamp "Checking backend health endpoint..."
$domain = $null
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile
    foreach ($line in $envContent) {
        if ($line -match '^DOMAIN_NAME=(.+)$') { $domain = $Matches[1].Trim() }
        if ($line -match '^PORT=(\d+)$') { $port = $Matches[1].Trim() }
    }
}

if ($domain) {
    $url = "https://$domain/api/health"
} else {
    if (-not $port) { $port = 3001 }
    $url = "http://localhost:$port/api/health"
}

Write-Output "Checking URL: $url"

# Allow insecure TLS for quick local checks
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { return $true }

try {
    $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec $HttpTimeoutSec -ErrorAction Stop
    if ($resp.ok -eq $true) { Write-Output "Health OK: $($resp | ConvertTo-Json -Depth 2)" } else { $errors += 'health endpoint returned non-ok' }
} catch {
    Write-Err "Health check failed: $_"
    $errors += 'health endpoint unreachable or returned error'
}

Write-Stamp "Summary"
if ($errors.Count -eq 0) {
    Write-Output "All checks passed"
    exit 0
} else {
    Write-Err "One or more checks failed:"
    foreach ($e in $errors) { Write-Output " - $e" }
    exit 1
}
