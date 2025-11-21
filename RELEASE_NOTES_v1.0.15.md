# Release Notes: v1.0.15

**Release Date:** 2024-07-26

This release focuses on preparing the Customer Management Portal for its first public release. It includes critical bug fixes, significant installation and data seeding improvements, and important security hardening.

---

### 🚀 Features & Enhancements

1.  **Improved Installation & Seeding:**
    *   The installation process now automatically seeds the database with a safe, non-sensitive default configuration for application settings, including `general`, `panel`, `telegram`, `update`, and `cert`. This ensures a better out-of-the-box experience.
    *   The database migration runner (`run_migrations.js`) has been enhanced to automatically detect and apply all individual `.sql` migration files from the `backend/migrations/` directory. This makes the migration process more robust and easier to manage.

2.  **Default Data:**
    *   A fresh installation will continue to seed a default admin user, 4 sample servers, and 5 sample users per server, providing a helpful starting point for new users.

---

### 🐛 Bug Fixes

*   **Critical API Fix:** Resolved a 500 Internal Server Error on the `GET /api/servers` endpoint. The error was caused by missing columns (`owner`, `service_type`, `ip_address`, `domain_name`) in the `servers` table in some environments. A new database migration has been added to correct the schema.

---

### 🔒 Security Hardening

1.  **Removed Committed Secrets:**
    *   A `.env` file containing local database credentials was removed from the repository.
    *   A `.db` database export file containing a Telegram bot token was removed from the repository.

2.  **Hardened `.gitignore`:**
    *   The `.gitignore` file has been updated to explicitly ignore `.env` files, the `public/uploads/` directory, and `*.db` files. This prevents accidental commits of sensitive credentials, user-uploaded content, and database backups.

---

### ⚠️ Important Notes for Developers

*   **Purging Repository History:** This release removes sensitive files from the *current* state of the `main` branch. However, these files still exist in the Git history. It is **strongly recommended** to purge the repository history to permanently remove them. This is a destructive action and should be performed with caution. Instructions will be provided separately.
