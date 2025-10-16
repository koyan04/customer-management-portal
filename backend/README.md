# Backend — migrations & seeding

This folder contains the Express backend and migration helpers.

Quick steps to run migrations and seed the initial admin (PowerShell):

1. Make sure your Postgres env variables are set in the PowerShell session (or in a .env file read by dotenv):

```powershell
$env:DB_HOST = 'localhost'
$env:DB_PORT = '5432'
$env:DB_USER = 'your_db_user'
$env:DB_DATABASE = 'your_db_name'
$env:DB_PASSWORD = 'your_db_password' # optional if using .pgpass or other auth
```

2. Run the SQL migrations (from the repo root):

```powershell
# from repository root
cd backend; npm run migrate
```

3. Verify migrations (optional):

```powershell
cd backend; npm run check-migrations
```

4. Seed the initial admin account:

```powershell
# from backend/
node seedAdmin.js
```

Notes:
- The `migrate` npm script executes the `psql` command using PowerShell so environment variables (e.g. $env:DB_HOST) are interpolated correctly. If you prefer, run psql directly from your shell instead of the npm script.
- Ensure `psql` is installed and available on your PATH.
