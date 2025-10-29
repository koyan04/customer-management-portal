This folder contains SQL migrations for the backend database.

2025-10-29 migration: add admins_audit
- Adds `admins.updated_at` column to record last update time.
- Adds `admins_audit` table to record INSERT and UPDATE events on `admins`.
  - Note: the audit intentionally redacts `password_hash` from the stored `old`/`new` JSON to avoid duplicating password hashes in audit logs.
  - The `admins_audit` table includes a `password_changed` boolean flag which is set to true when the `password_hash` field actually changes.

Guidance
- Run migrations in staging before production.
- Treat `admins_audit` as sensitive: while password_hash is redacted, the table still contains account metadata and should be protected in backups and access controls.
- If you need stronger auditing (who changed which fields), consider expanding the trigger to record `changed_fields` as an array of field names.
