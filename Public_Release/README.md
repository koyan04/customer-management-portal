# Public Release Package

This `Public_Release` directory contains the sanitized distribution of the Customer Management Portal.

## Contents
- `backend/` (application code, sanitized)
- `backend/migrations/000_schema.sql` (full schema-only migration for public install)
- `backend/migrations/001-017-table-*.sql` (per-table schema migrations for granular inspection)
- `frontend/` (placeholder – include built assets or source as needed)
- `scripts/` (add install/bootstrap scripts here if required)

## Exclusions
The following development or sensitive artifacts are intentionally omitted:
- Original development migrations in `backend/migrations/` (replaced by `000_schema.sql`)
- Upload data `backend/public/uploads/`
- Local environment files (`.env`, tokens, temp/test scripts, logs)
- Transient temp/debug scripts (`temp_*.js`, `tmp_*.js`)

## Installing
1. Provide a PostgreSQL database and user.
2. Create an `.env` inside `backend/`:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_password
DB_DATABASE=cmp
JWT_SECRET=generate_a_long_random_value
```
3. Run migrations:
```
cd backend
npm install
npm run migrate
```
4. Seed an admin if required:
```
node seedAdmin.js
```
5. Start the server:
```
node index.js
```

## Updating Before Push
Always regenerate or update `Public_Release` prior to pushing to GitHub:

### Automated Sync (Recommended)
Use the provided sync script to regenerate all schema migrations from the live database:

```powershell
# From project root
cd scripts
.\sync-public-release.ps1
```

The script will:
- Generate `000_schema.sql` (full schema)
- Create per-table migrations (`001-table-*.sql` through `017-table-*.sql`)
- Validate output for completeness

Then review and commit:
```powershell
git add Public_Release/backend/migrations/
git commit -m "chore(release): sync schema migrations"
git push
```

### Manual Sync (Alternative)
If you prefer manual regeneration:
1. Full schema: `pg_dump -s -h localhost -U postgres -d user_management_portal > Public_Release/backend/migrations/000_schema.sql`
2. Per-table: Run sync script or dump tables individually
3. Review for sensitive data (ensure schema-only, no data)
4. Commit and push

## Migration Strategy

### Schema Files
- **`000_schema.sql`**: Full consolidated schema (all tables, indexes, constraints). Use this for fresh installs.
- **`001-017-table-*.sql`**: Per-table schemas for granular review and selective application.

### Usage
For a fresh installation, run only `000_schema.sql`:
```bash
psql -h localhost -U postgres -d cmp -f migrations/000_schema.sql
```

For incremental updates or debugging, apply individual table migrations as needed.

## Notes
- All schema files are schema-only (no data). Application seeds or runtime scripts handle inserting defaults.
- Per-table migrations are regenerated from the live database before each release to ensure consistency.
- Development migrations (`backend/migrations/`) are excluded from public releases to avoid exposing internal evolution.
