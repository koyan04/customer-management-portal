<#
WINDOWS_FIX_PG_PATH.ps1

Detect common PostgreSQL installation bin folders and offer to add one to PATH.

Run as Administrator to modify the system PATH. If run without admin, the script will offer to update the current user's PATH instead.

Usage:
  Open Administrator PowerShell and run:
    .\scripts\WINDOWS_FIX_PG_PATH.ps1

This script will:
- check if `psql` is already available in PATH
- search common install locations for `psql.exe`
- let you pick one and add it to system PATH (or user PATH if not admin)
#>

function Write-Stamp([string]$m) { Write-Output "[$(Get-Date -Format o)] $m" }

Write-Stamp "Postgres PATH quick-fix starting..."

try {
    $psqlVersion = & psql --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $psqlVersion) {
        Write-Output "psql found in PATH: $psqlVersion"
        exit 0
    }
} catch {
    Write-Output "psql check failed or not available"
}

Write-Stamp "psql not found in PATH. Searching common locations..."

$candidates = @()

# Common Program Files locations
$programFiles = @(${env:ProgramFiles}, ${env:ProgramFiles(x86)}) | Where-Object { $_ }
foreach ($base in $programFiles) {
    $pgRoot = Join-Path -Path $base -ChildPath 'PostgreSQL'
    if (Test-Path $pgRoot) {
        Get-ChildItem -Path $pgRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $bin = Join-Path -Path $_.FullName -ChildPath 'bin'
            if (Test-Path (Join-Path -Path $bin -ChildPath 'psql.exe')) { $candidates += $bin }
        }
    }
}

# EnterpriseDB common path fallback
Get-ChildItem -Path 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $b = Join-Path -Path $_.FullName -ChildPath 'bin'
    if (Test-Path (Join-Path -Path $b -ChildPath 'psql.exe')) { $candidates += $b }
}

# Other common locations
$other = @('C:\Postgres\bin','C:\pgsql\bin')
foreach ($p in $other) { if (Test-Path (Join-Path -Path $p -ChildPath 'psql.exe')) { $candidates += $p } }

# Deduplicate
$candidates = $candidates | Select-Object -Unique

if ($candidates.Count -eq 0) {
    Write-Stamp "No common PostgreSQL bin folders detected. If you installed Postgres manually, add its bin folder (containing psql.exe) to PATH and re-open PowerShell."
    Write-Output "Common path example: C:\Program Files\PostgreSQL\15\bin"
    exit 2
}

Write-Stamp "Found candidate PostgreSQL bin folders:"
for ($i=0; $i -lt $candidates.Count; $i++) { Write-Output "[$($i+1)] $($candidates[$i])" }

$sel = Read-Host "Select the number to add to PATH (or blank to cancel)"
if (-not $sel) { Write-Output "Cancelled by user"; exit 3 }
if (-not ($sel -as [int]) -or $sel -lt 1 -or $sel -gt $candidates.Count) { Write-Output "Invalid selection"; exit 4 }

$choice = $candidates[$sel - 1]
Write-Stamp "You selected: $choice"

# Determine if running elevated
function Test-IsAdmin {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$isAdmin = Test-IsAdmin
if ($isAdmin) { Write-Output "Running elevated: will modify machine PATH" } else { Write-Output "Not running as admin: will modify current user's PATH only" }

if ($isAdmin) {
    $scope = 'Machine'
} else {
    $scope = 'User'
}

try {
    $currentPath = [Environment]::GetEnvironmentVariable('Path', $scope)
    if ($currentPath -like "*$choice*") {
        Write-Output "Selected path already in PATH"; exit 0
    }
    $newPath = $currentPath.TrimEnd(';') + ';' + $choice
    [Environment]::SetEnvironmentVariable('Path', $newPath, $scope)
    Write-Output "Path updated for scope=$scope. You may need to re-open PowerShell or sign out/in for system PATH changes to take effect."
    # update current session PATH for convenience
    $env:Path = $env:Path + ';' + $choice
    Write-Output "Updated current session PATH temporarily. psql available?"
    try { $ver = & psql --version 2>$null; if ($ver) { Write-Output " YES: $ver" } else { Write-Output " NO" } } catch { Write-Output " NO" }
} catch {
    Write-Err "Failed to update PATH: $_"
    exit 5
}

Write-Stamp "Done"
exit 0
