## Windows manual (hands-on) installation guide

This document provides step-by-step, hands-on instructions to install and run the Customer Management Portal on a Windows host (Windows 10/11 or Windows Server). This guide favors reproducible manual steps over a fully-automated, one-shot installer.

Use this guide if you prefer to control each step (recommended for production on Windows) or if the automated `scripts/install-windows.ps1` fails on your environment.

---

## Summary (what you'll do)

- Install prerequisites: Node.js (LTS), Git, and a PostgreSQL server (local or managed)
- Install global helpers: `pm2` (or `pm2-windows-service`) and optionally `nssm` for service registration
- Clone repo, install backend/frontend dependencies, build frontend
- Configure `backend/.env` with DB connection and secrets
- Run migrations and seed admin + sample data
- Configure TLS (win-acme or Cloudflare origin certs) and post-renew hooks
- Register services so backend and optional telegram bot autorun on system start

---

## 1. Prepare the machine

- Windows 10/11 (desktop) or Windows Server 2019/2022. Use an Administrator account.
- Ensure you have Internet access and enough disk space.
- Recommended: use a Windows VM (Hyper-V, VirtualBox, VMware) for initial tests.

Open PowerShell as Administrator for all commands below.

## 2. Install package manager (optional but helpful)

- Optional: install Chocolatey (https://chocolatey.org) or use winget (Windows 10/11 built-in on modern systems).

Chocolatey quick install (Admin PowerShell):

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

Verify availability:

```powershell
Get-Command winget -ErrorAction SilentlyContinue
Get-Command choco -ErrorAction SilentlyContinue
```

## 3. Install Node.js and Git

If you have winget or choco, use them; otherwise download installers from official sites.

Using winget (preferred):

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
```

Or Chocolatey:

```powershell
choco install nodejs-lts -y
choco install git -y
```

Verify:

```powershell
node --version
npm --version
git --version
```

## 4. Install PostgreSQL (recommended: managed DB for production)

You can install PostgreSQL locally on Windows or use a managed host (e.g., AWS RDS, Azure Database). For production on Windows we recommend managed DB where possible.

Local installation with EnterpriseDB (manual):

1. Download installer from https://www.enterprisedb.com/downloads/postgres-postgresql-downloads
2. Run the installer as Administrator and choose an installation directory (note the `postgres` superuser password you set).
3. Ensure the PostgreSQL bin directory (e.g., `C:\Program Files\PostgreSQL\15\bin`) is added to PATH.

Verify `psql`:

```powershell
psql --version
```

If you prefer package managers, try winget/choco, but manual installer gives full control and predictable results.

## 5. Clone the repo and prepare the project

Choose an install folder, e.g., `C:\srv\cmp`:

```powershell
$InstallDir = 'C:\srv\cmp'
New-Item -ItemType Directory -Path $InstallDir -Force
cd $InstallDir
git clone https://github.com/koyan-testpilot/customer-management-portal.git .
```

Install backend dependencies and build frontend:

```powershell
cd $InstallDir\backend
npm install --no-audit

cd $InstallDir\frontend
npm install --no-audit
npm run build

# Return to backend
cd $InstallDir\backend
```

## 6. Configure `backend/.env`

Create or edit `backend/.env` with required values. Minimum entries:

```
PORT=3001
DOMAIN_NAME=example.com
LETSENCRYPT_EMAIL=you@example.com
START_TELEGRAM_BOT=true
JWT_SECRET=<pick-a-long-random-secret>
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=cmp
DB_USER=cmp
DB_PASSWORD=changeme
```

Notes:
- Use a secure `JWT_SECRET` (32+ random bytes). Do not commit `.env` to Git.
- If using managed Postgres, set `DB_HOST` accordingly and ensure network access/firewall rules allow connections.

## 7. Run migrations and seed data

From `backend`:

```powershell
node run_migrations.js
# Optionally seed admin and sample data (set env vars or pass them inline):
$env:SEED_ADMIN_USERNAME='admin'; $env:SEED_ADMIN_PASSWORD='admin123'; node seedAdmin.js
node seedServers.js
node seedUsers.js
```

Verify the admin user exists by connecting to Postgres and running a SQL query or use the admin login.

## 8. Start backend (dev) and verify

For initial verification, run the backend directly:

```powershell
cd $InstallDir\backend
node index.js
```

Open a browser and visit `http://localhost:3001/api/health` to verify the app starts.

To stop the dev run, Ctrl+C.

## 9. Use PM2 or a Windows service to run in production

Option A — PM2 with pm2-windows-service (recommended):

```powershell
npm install -g pm2
npm install -g pm2-windows-service
pm2 start pm2.config.js --env production
pm2 save
# Install pm2 as a Windows service
pm2-service-install -n pm2
# This will create a Windows service that runs PM2 on boot
```

Option B — NSSM (native Windows service manager):

1. Download NSSM from https://nssm.cc and extract `nssm.exe` to a folder in PATH or `C:\nssm`.
2. Register the service (run from `backend` folder):

```powershell
nssm install cmp-backend "C:\Program Files\nodejs\node.exe" "index.js"
nssm set cmp-backend AppDirectory "C:\srv\cmp\backend"
nssm set cmp-backend Start SERVICE_AUTO_START
nssm start cmp-backend
```

Repeat similarly for `telegram_bot.js` if you use the bot.

Option C — NSSM by PowerShell helper (if you prefer scripted approach): the repo includes `scripts/install-windows.ps1` as an optional helper that can register services using NSSM. Use it if you want a semi-automated approach, but prefer the manual steps above for predictable production installs.

## 10. TLS on Windows (win-acme or Cloudflare origin certs)

Two recommended approaches:

- Use win-acme (https://www.win-acme.com/) to obtain Let's Encrypt certs on Windows and configure auto-renewal hooks to restart the backend service.
  - Download win-acme, run the interactive wizard to request certs via HTTP-01 or DNS-01 (Cloudflare DNS plugin can be used), and configure renewal tasks.
- Or use Cloudflare Origin Certificates + reverse proxy (IIS or Nginx for Windows) to terminate TLS and forward to the backend on localhost:3001.

Cert renew hook example (win-acme): configure a post-renew script that restarts cmp-backend service:

```powershell
net stop cmp-backend
net start cmp-backend
```

## 11. Verify autorun after reboot

Reboot the VM and verify services start automatically:

```powershell
Restart-Computer -Force
# After reboot (open Admin PowerShell)
pm2 list        # if using pm2-service
Get-Service -Name cmp-backend   # if using nssm-installed service
curl -I https://your-domain/  # check TLS endpoint if configured
```

## 12. Troubleshooting checklist

- If `psql` is not found after installing Postgres, add the bin folder to PATH and re-open PowerShell. Example PATH: `C:\Program Files\PostgreSQL\15\bin`.
- If `node index.js` fails, tail `server_err.log` and `server_out.log` (wherever you configured them) and check `backend/server.err` in the repo for recent runtime logs.
- If migrations fail, inspect `node run_migrations.js` output and check DB connectivity parameters in `backend/.env`.
- If PM2 does not persist on reboot, ensure `pm2 save` was run and that `pm2-service-install` (or other service registration) was performed.

## 13. Security and production notes

- Use a strong `JWT_SECRET`. Rotate if suspecting leaks.
- Limit administrative access to the host and DB. Prefer managed DB with private network connectivity for production.
- Don’t use default seeded credentials in production; change seeded admin password immediately.
- Back up DB and configuration regularly; test restore process in a staging environment.

## 14. Optional: Using the PowerShell helper as a convenience

- The repository includes `scripts/install-windows.ps1`. It attempts a best-effort automation (winget/choco/EDB fallback) and can register services using NSSM. Use it if you want a semi-automated approach, but prefer the manual steps above for predictable production installs.

### Postgres PATH quick-fix

If you installed PostgreSQL manually and `psql` is not available in PowerShell, there's a small helper script that detects common Postgres `bin` directories and can add the selected one to your PATH:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\scripts\WINDOWS_FIX_PG_PATH.ps1
```

Run it in an Administrator PowerShell to update the system PATH. If you run it as a regular user it will update your user PATH instead and prompt accordingly.

After updating PATH, re-open PowerShell or sign out/in to fully pick up the change.

---

If you want, I can now:

- A) Add a short `WINDOWS_QUICKCHECK.ps1` script that runs post-install verification steps (psql --version, pm2 list, test health endpoint) and returns a status summary, or
- B) Update `README.md` to prominently link to this `WINDOWS_INSTALL.md` and mark `scripts/install-windows.ps1` as optional helper (I can do that now), or
- C) Walk you through running a single verification step interactively here (you run a command and paste output).

Which would you like next? (A / B / C)

Quickcheck script
-----------------
I added `scripts/WINDOWS_QUICKCHECK.ps1` as a small post-install verification script. Run it from an Administrator PowerShell after installation to get a quick pass/fail summary:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\scripts\WINDOWS_QUICKCHECK.ps1 -InstallDir C:\srv\cmp
```

The script checks Node/npm, psql, `backend/.env` DB entries, `pm2` and the `cmp-backend` process registration, and the backend `/api/health` endpoint. It exits with code 0 on success and 1 on failure, and prints a short list of failing checks.
