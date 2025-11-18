# Public Release Package

This `Public_Release` directory contains the sanitized distribution of the Customer Management Portal.

## Contents
- `backend/` (application code, sanitized)
- `backend/migrations/000_schema.sql` (schema-only migrations for public install)
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
1. Re-run schema dump: `pg_dump -s -h <host> -U <user> -d <db> > Public_Release/backend/migrations/000_schema.sql`
2. Review for sensitive data (ensure schema-only, no data).
3. Commit and push.

## Notes
- The schema file is schema-only (no data). Application seeds or runtime scripts handle inserting defaults.
- If you need versioned incremental migrations, reintroduce separate files; for now this consolidated schema is the authoritative baseline.
