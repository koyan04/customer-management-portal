<#
Install helper for Windows (PowerShell)

This script attempts to automate the common steps to run the Customer Management Portal
on a Windows host. It focuses on installing Node/npm if missing, cloning the repo (or
updating an existing clone), installing dependencies, building the frontend and starting
the backend using PM2 (and optionally registering services with NSSM if available).

NOTE: Installing PostgreSQL, obtaining certificates via Let's Encrypt, or configuring
DNS on Windows is environment-specific. This script gives sensible defaults and
instructions for those steps, but it does not attempt to run a full Windows PostgreSQL
installer or manage TLS via certbot (use win-acme or Cloudflare origin certs instead).

Usage (run as Administrator in PowerShell):
    Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
    .\install-windows.ps1 -InstallDir C:\srv\cmp -RepoUrl https://github.com/koyan-testpilot/customer-management-portal.git

Parameters:
    -InstallDir  Directory to install the project (default: C:\srv\cmp)
    -RepoUrl     Git repository URL (default: repository remote)
    -NonInteractive  If set, the script will avoid interactive prompts and try best-effort installs

#>

param(
    [string]$InstallDir = "C:\\srv\\cmp",
    [string]$RepoUrl = 'https://github.com/koyan-testpilot/customer-management-portal.git',
    [switch]$NonInteractive,
    [switch]$InstallPostgres,
    [string]$DBName = 'cmp',
    [string]$DBUser = 'cmp',
    [System.Security.SecureString]$DBPassword = $null,
    [System.Security.SecureString]$PostgresSuperPassword = $null,
    # Optional: explicitly checkout a ref/tag after pulling the repo. If omitted the script will try to use the latest semver tag.
    [string]$CheckoutRef,
    # Optional: seed an admin account after migrations. If set, you can optionally pass username/password.
    [switch]$SeedAdmin,
    [string]$SeedAdminUser = 'admin',
    [System.Security.SecureString]$SeedAdminPass
)

# Helper to convert SecureString to plain text for short-lived use
function Convert-SecureToPlain([System.Security.SecureString]$s) {
    if (-not $s) { return $null }
    if ($s -is [System.Security.SecureString]) {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    }
    return $s
}

function Assert-Admin {
    if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator. Right-click PowerShell and choose 'Run as administrator'."
        exit 1
    }
}

# Logging helpers to avoid Write-Host (PSScriptAnalyzer recommends using Write-Output/Write-Verbose/etc.)
function Write-Info([string]$m) { Write-Output $m }
function Write-Ok([string]$m) { Write-Output $m }
function Write-Warn([string]$m) { Write-Warning $m }
function Write-Err([string]$m) { Write-Error $m }

function Get-ExecutablePath([string]$name) {
    $env:PATH.Split(';') | ForEach-Object { Join-Path $_ $name } | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Install-WithWingetOrChoco([string]$packageName, [string]$wingetId, [string]$chocoId) {
    # Try winget first, then choco
    if (Get-Command winget -ErrorAction SilentlyContinue) {
            Write-Info "Installing $packageName via winget..."
        winget install --id=$wingetId -e --accept-package-agreements --accept-source-agreements
        return $?
    }
    if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Info "Installing $packageName via Chocolatey..."
        choco install $chocoId -y
        return $?
    }
    Write-Warn "Neither winget nor choco available to install $packageName. Please install it manually."
    return $false
}

Assert-Admin

Write-Info "Install directory: $InstallDir"

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

Set-Location $InstallDir

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Info "Git not found. Attempting to install git..."
    Install-WithWingetOrChoco -packageName 'Git' -wingetId 'Git.Git' -chocoId 'git'
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Info "Node.js not found. Attempting to install Node.js LTS..."
    # Winget package id for Node LTS may differ; this is a best-effort attempt
    Install-WithWingetOrChoco -packageName 'Node.js LTS' -wingetId 'OpenJS.NodeJS.LTS' -chocoId 'nodejs-lts'
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Err "npm not found after Node install. Please ensure Node/npm exists in PATH and re-run this script."; exit 1
}

if ($InstallPostgres) {
    Write-Info "Postgres automation requested. Attempting to install PostgreSQL (winget/choco)..."
    $pgInstalled = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Info "Trying winget install of PostgreSQL using multiple candidate IDs..."
        $wingetIds = @('PostgreSQL.PostgreSQL','Postgres.Postgres','postgresql.postgres','PostgreSQL.Postgres')
        foreach ($id in $wingetIds) {
            try {
                Write-Info "Attempting winget install --id=$id"
                winget install --id=$id -e --accept-package-agreements --accept-source-agreements
                if ($LASTEXITCODE -eq 0) { $pgInstalled = $true; break }
            } catch {
                Write-Warn "winget install for $id failed: $_"
            }
        }
    }
    if (-not $pgInstalled -and (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Info "Trying Chocolatey install of postgresql..."
        try {
            choco install postgresql -y
            if ($LASTEXITCODE -eq 0) { $pgInstalled = $true }
        } catch {
            Write-Warn "choco PostgreSQL install failed: $_"
        }
    }

    # Fallback: try downloading the EnterpriseDB installer and running unattended
    if (-not $pgInstalled) {
    Write-Warn "winget/choco install attempts failed. Attempting to download EnterpriseDB installer as a fallback..."
        # Allow overriding version via env or variable
        $PG_VERSION = $env:PG_VERSION; if (-not $PG_VERSION) { $PG_VERSION = '15.4' }
            $installerName = "postgresql-$PG_VERSION-windows-x64.exe"
        $downloadUrl = "https://get.enterprisedb.com/postgresql/$installerName"
        $tmpInstaller = Join-Path $env:TEMP $installerName
    Write-Info "Downloading $downloadUrl to $tmpInstaller (may take a while)..."
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpInstaller -UseBasicParsing -ErrorAction Stop
            Write-Info "Downloaded installer. Attempting unattended install..."
            # Common EDB unattended args: --mode unattended --unattendedmodeui none --superpassword <pw>
            $edbArgs = @('--mode','unattended','--unattendedmodeui','none')
            if ($PostgresSuperPassword) { $edbArgs += "--superpassword"; $edbArgs += (Convert-SecureToPlain $PostgresSuperPassword) }
            Start-Process -FilePath $tmpInstaller -ArgumentList $edbArgs -Wait -NoNewWindow
            if ($LASTEXITCODE -eq 0 -or $? ) { $pgInstalled = $true }
        } catch {
            Write-Warn "Failed to download or run EDB installer: $_"
        }
    }

    if (-not $pgInstalled) {
    Write-Warn "Automatic PostgreSQL install not available. Please install PostgreSQL manually and re-run this script with -InstallPostgres flag omitted."
    } else {
    Write-Info "Waiting for psql to be available in PATH (timeout 2 minutes)..."
        $timeout = [DateTime]::UtcNow.AddMinutes(2)
        while (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
            if ([DateTime]::UtcNow -gt $timeout) { break }
            Start-Sleep -Seconds 3
        }

        if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
            Write-Warn "psql not found after installer. Please ensure PostgreSQL client is in PATH and retry manual provisioning."
        } else {
            # Prompt for postgres superuser password if not provided
            if (-not $PostgresSuperPassword) {
                $PostgresSuperPassword = Read-Host -AsSecureString "Enter the 'postgres' superuser password (needed to create DB/user)" | ConvertFrom-SecureString
                # ConvertFrom-SecureString returns encrypted string; we'll prompt user to set an env var instead
                Write-Info "NOTE: For non-interactive runs provide -PostgresSuperPassword '<password>' (unencrypted) when invoking the script."
                # Re-ask in plain-text for immediate use (interactive)
                $PostgresSuperPassword = Read-Host "Re-enter postgres superuser password (will not be saved)"
            }

            if (-not $PostgresSuperPassword) {
                Write-Warn "No postgres superuser password provided; cannot auto-create DB/user. Skipping DB creation."
            } else {
                Write-Info "Creating database user and database: user='$DBUser', db='$DBName'..."
                # Use PGPASSWORD process env var to supply password to psql without assigning to automatic $env variable
                $oldEnv = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
                $psqlPassPlain = Convert-SecureToPlain $PostgresSuperPassword
                [Environment]::SetEnvironmentVariable('PGPASSWORD', $psqlPassPlain, 'Process')
                try {
                    $plainDbPass = Convert-SecureToPlain $DBPassword
                    & psql -U postgres -c "CREATE USER \"$DBUser\" WITH PASSWORD '$plainDbPass'" 2>&1 | Write-Output
                    & psql -U postgres -c "CREATE DATABASE \"$DBName\" OWNER \"$DBUser\"" 2>&1 | Write-Output
                    & psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE \"$DBName\" TO \"$DBUser\"" 2>&1 | Write-Output
                } catch {
                    Write-Err "Error creating DB/user: $_"
                } finally {
                    if ($null -ne $oldEnv) { [Environment]::SetEnvironmentVariable('PGPASSWORD', $oldEnv, 'Process') } else { [Environment]::SetEnvironmentVariable('PGPASSWORD', $null, 'Process') }
                }

                # Write backend/.env entries for DB
                $envFile = Join-Path -Path (Join-Path -Path $InstallDir -ChildPath 'backend') -ChildPath '.env'
                Write-Info "Writing DB connection to $envFile (overwrites DB_HOST/DB_* keys if present)..."
                $dbEnvLines = @()
                $dbEnvLines += "DB_HOST=localhost"
                $dbEnvLines += "DB_PORT=5432"
                $dbEnvLines += "DB_DATABASE=$DBName"
                $dbEnvLines += "DB_USER=$DBUser"
                $dbEnvLines += "DB_PASSWORD=$DBPassword"
                if (Test-Path $envFile) {
                    # preserve other env lines; replace DB_* lines
                    $existing = Get-Content $envFile
                    $filtered = $existing | Where-Object { $_ -notmatch '^(DB_HOST|DB_PORT|DB_DATABASE|DB_USER|DB_PASSWORD)=' }
                    $filtered + $dbEnvLines | Set-Content $envFile -Encoding UTF8
                } else {
                    $dbEnvLines | Set-Content $envFile -Encoding UTF8
                }

                Write-Info "Running migrations..."
                Push-Location -Path (Join-Path $InstallDir 'backend')
                node run_migrations.js
                Pop-Location

                Write-Info "Seeding admin and sample data (optional). You can set SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD as env vars before running the seed scripts."
                Write-Info "Example (PowerShell):`n`$env:SEED_ADMIN_USERNAME='admin'; `$env:SEED_ADMIN_PASSWORD='admin123'; node seedAdmin.js"
            }
        }
    }
}

if (-not (Test-Path (Join-Path $InstallDir '.git'))) {
    Write-Info "Cloning repository into $InstallDir..."
    git clone $RepoUrl $InstallDir
} else {
    Write-Info "Repository already present, pulling latest..."
    git -C $InstallDir pull

    # If caller supplied an explicit CheckoutRef, use it (mirror CMP_CHECKOUT_REF behavior)
    if ($CheckoutRef) {
        Write-Info "Checking out requested ref: $CheckoutRef"
        git -C $InstallDir checkout $CheckoutRef
    } else {
        # Attempt to checkout the latest semantic release tag (prefer vMAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH)
        # Exclude common prerelease suffixes (alpha, beta, rc, dev).
        try {
            $allTags = git -C $InstallDir for-each-ref --sort=-v:refname --format='%(refname:strip=2)' refs/tags 2> $null
        } catch {
            $allTags = @()
        }
        $latestTag = $allTags | Where-Object { $_ -match '^[vV]?\d+(\.\d+){1,2}$' -and ($_ -notmatch '-(alpha|beta|rc|dev)') } | Select-Object -First 1
        if ($latestTag) {
            Write-Info "Auto-checkout latest release tag: $latestTag"
            git -C $InstallDir checkout $latestTag
        } else {
            Write-Warn "No semver-like tags found; staying on current branch"
        }
    }
}

# Install global tools
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
    Write-Info "Installing pm2 globally..."
    npm install -g pm2
}

# Install optional nssm for service registration
$nssmPath = Get-ExecutablePath 'nssm.exe'
if (-not $nssmPath) {
    Write-Info "NSSM (nssm.exe) not found. Attempting to install via package manager..."
    if (-not (Install-WithWingetOrChoco -packageName 'nssm' -wingetId 'NSSM.NSSM' -chocoId 'nssm')) {
        Write-Warn "Unable to install nssm automatically. You can install nssm manually from https://nssm.cc/ and re-run this script to register Windows services."
    } else {
    $nssmPath = Get-ExecutablePath 'nssm.exe'
    }
}

Write-Info "Installing backend dependencies..."
Push-Location -Path (Join-Path $InstallDir 'backend')
npm install --no-audit

Write-Info "Building frontend..."
Push-Location -Path (Join-Path $InstallDir 'frontend')
npm install --no-audit
npm run build
Pop-Location

Write-Info "Starting backend processes via pm2..."
Push-Location -Path (Join-Path $InstallDir 'backend')
if (Test-Path pm2.config.js) {
    pm2 start pm2.config.js --env production
} else {
    pm2 start index.js --name cmp-backend
}
pm2 save

if ($nssmPath) {
    Write-Info "Registering Windows services with NSSM..."
    # Register cmp-backend
    $backendExe = (Get-Command node).Source
    $backendDir = (Get-Location).Path
    & $nssmPath install cmp-backend $backendExe 'index.js'
    & $nssmPath set cmp-backend AppDirectory $backendDir
    & $nssmPath set cmp-backend AppStdout (Join-Path $backendDir 'server_out.log')
    & $nssmPath set cmp-backend AppStderr (Join-Path $backendDir 'server_err.log')
    & $nssmPath set cmp-backend Start SERVICE_AUTO_START
    Write-Info "cmp-backend service installed (nssm). Start with: nssm start cmp-backend"
    # Register telegram bot if present in pm2 config
    if (Test-Path pm2.config.js -and (Select-String -Path pm2.config.js -Pattern 'cmp-telegram-bot' -SimpleMatch -Quiet)) {
        & $nssmPath install cmp-telegram-bot $backendExe 'telegram_bot.js'
        & $nssmPath set cmp-telegram-bot AppDirectory $backendDir
        & $nssmPath set cmp-telegram-bot Start SERVICE_AUTO_START
    Write-Info "cmp-telegram-bot service installed (nssm)."
    }
} else {
    Write-Warn "NSSM not available: skipping Windows service registration. PM2 was started and saved; to run on boot you can install a PM2 Windows service (pm2-windows-service) or use NSSM."
    Write-Info "To install pm2-windows-service (requires administrator credentials): npm i -g pm2-windows-service && pm2-service-install -n pm2";
}

Write-Info "Note: Database (PostgreSQL) and TLS setup are environment-specific on Windows."
Write-Info "If you have a PostgreSQL server available, update backend/.env with DB connection details and run migrations:";
Write-Info "    cd $InstallDir\\backend";
Write-Info "    node run_migrations.js";

Write-Info "Seeding admin and sample data (optional). You can provide SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD as environment variables before running seed scripts."
Write-Info "Example:";
Write-Info "    $env:SEED_ADMIN_USERNAME='admin'; $env:SEED_ADMIN_PASSWORD='admin123'; node seedAdmin.js";

Write-Info "TLS on Windows: consider using win-acme (https://www.win-acme.com/) to obtain Let's Encrypt certs, or use Cloudflare Origin Certificates with a reverse proxy (IIS, Nginx) in front of this service."

Pop-Location

Write-Info "Windows install helper finished. Verify services are running and adjust backend/.env as needed."

# Optional automated seeding controlled by the -SeedAdmin flag. This avoids writing passwords to disk
# unless the operator chooses to persist them separately. When seeding occurs we print a ONE-TIME
# credential message to stdout and do NOT write the password into backend/.env.
if ($SeedAdmin) {
    Write-Info "[INFO] SeedAdmin requested. Preparing to create admin user..."
    # Choose username/password: prefer explicit parameters, else prompt (interactive) or generate.
    $sUser = $SeedAdminUser
    $sPass = $SeedAdminPass
    if (-not $sPass) {
            if ($NonInteractive) {
            # Generate a reasonably strong random password (12 chars)
            $sPass = ([System.Guid]::NewGuid().ToString('N')).Substring(0,12)
            Write-Info "[INFO] No admin password supplied; generated one-time password."
        } else {
            $sPass = Read-Host -AsSecureString "Enter desired admin password (leave blank to auto-generate)"
            $plain = ''
            if ($sPass) { $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sPass)) }
            if (-not $plain) { $plain = ([System.Guid]::NewGuid().ToString('N')).Substring(0,12); Write-Info "[INFO] Generated one-time admin password." }
            $sPass = $plain
        }
    }

    # Run the seed script using environment variables (process-scoped only)
    Push-Location -Path (Join-Path $InstallDir 'backend')
    $oldSeedUser = $env:SEED_ADMIN_USERNAME
    $oldSeedPass = $env:SEED_ADMIN_PASSWORD
    $env:SEED_ADMIN_USERNAME = $sUser
    $env:SEED_ADMIN_PASSWORD = $sPass
    try {
        Write-Info "[INFO] Running node seedAdmin.js to create admin user..."
        node seedAdmin.js 2>&1 | Write-Output
        Write-Output "`nONE-TIME CREDENTIALS (rotate immediately):"
        Write-Output "    Username: $sUser"
        Write-Output "    Password: $sPass"
        Write-Output "NOTE: This password was NOT written to disk by the installer. Rotate on first login."
    } catch {
        Write-Err "[ERROR] Seeding admin failed: $_"
    } finally {
        # restore env
        if ($oldSeedUser) { $env:SEED_ADMIN_USERNAME = $oldSeedUser } else { Remove-Item Env:\SEED_ADMIN_USERNAME -ErrorAction SilentlyContinue }
        if ($oldSeedPass) { $env:SEED_ADMIN_PASSWORD = $oldSeedPass } else { Remove-Item Env:\SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue }
        Pop-Location
    }
}
