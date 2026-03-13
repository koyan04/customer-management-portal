# VChannel Customer Management Portal — Developer Guide

> **Stack:** Node.js / Express 5 (backend) · React 19 / Vite (frontend) · PostgreSQL (database)  
> **Last updated:** March 2026

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Technology Stack](#3-technology-stack)
4. [Environment Setup](#4-environment-setup)
5. [Database Schema](#5-database-schema)
6. [Backend Architecture](#6-backend-architecture)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [REST API Reference](#8-rest-api-reference)
9. [Frontend Architecture](#10-frontend-architecture)
10. [Frontend Pages Reference](#10-frontend-pages-reference)
11. [Frontend Components Reference](#11-frontend-components-reference)
12. [State Management & Context](#12-state-management--context)
13. [Key Server (Built-in HTTP File Server)](#13-key-server-built-in-http-file-server)
14. [Background Jobs & Schedulers](#14-background-jobs--schedulers)
15. [Telegram Bot Integration](#15-telegram-bot-integration)
16. [Testing](#16-testing)
17. [Build & Deployment](#17-build--deployment)
18. [Configuration Reference](#18-configuration-reference)
19. [Common Development Tasks](#19-common-development-tasks)
20. [Security Notes](#20-security-notes)
21. [Bot / Automation Integration Guide](#21-bot--automation-integration-guide)
22. [JSON Generator — Exact Algorithm for Bots](#22-json-generator--exact-algorithm-for-bots)

---

## 1. Project Overview

This is a full-stack customer management portal for VPN/proxy service providers (marketed under the name **VChannel**). It manages:

- Proxy **servers** and their **users** (subscriptions)
- Client **configuration file generation** (YAML / JSON / Clash / sing-box formats)
- A built-in **key server** that serves config files to end-user devices over HTTP
- **Domain pool** management
- **Financial reporting** (monthly revenue, snapshots)
- **Staff account** management with role-based access control (ADMIN, SERVER_ADMIN, VIEWER)
- **Telegram bot** for login notifications and alerts

---

## 2. Repository Structure

```
project-root/
├── backend/                    # Node.js / Express API server
│   ├── app.js                  # Express app setup, route mounting, middleware
│   ├── index.js                # HTTP server entry point (port resolution, startup)
│   ├── db.js                   # PostgreSQL pool (pg), timezone handling
│   ├── telegram_bot.js         # Telegram bot integration
│   ├── data/
│   │   ├── keyserver.json      # Key server runtime config (auto-created)
│   │   └── token_map.json      # Per-file token map for key server (auto-created)
│   ├── lib/
│   │   ├── dbCompat.js         # DB compatibility helpers
│   │   ├── ipGeolocation.js    # IP → city/country lookup
│   │   ├── logger.js           # Structured logger
│   │   ├── matview_detect.js   # Check if materialized views exist
│   │   ├── matview_refresh.js  # Queue-based async matview refresh
│   │   ├── matview_refresh_state.js
│   │   ├── sessionCleanup.js   # Cron: delete stale sessions
│   │   ├── settingsCache.js    # In-memory cache for app_settings rows
│   │   ├── snapshotScheduler.js# Cron: auto monthly financial snapshots
│   │   ├── telegramHelpers.js
│   │   └── validateSettings.js
│   ├── middleware/
│   │   └── authMiddleware.js   # JWT verify, isAdmin, isServerAdminOrGlobal
│   ├── migrations/             # Sequential SQL migration files (000 → 022)
│   ├── public/
│   │   ├── logos/              # Persisted logo uploads
│   │   └── uploads/            # Avatar and other uploads
│   ├── routes/
│   │   ├── admin.js            # /api/admin/* (accounts, settings, audit, backup)
│   │   ├── auth.js             # /api/auth/* (login, logout, refresh)
│   │   ├── domains.js          # /api/domains/* (domain pool)
│   │   ├── keyserver.js        # /api/keyserver/* (key server + config files)
│   │   └── servers.js          # /api/servers/* + /api/users/*
│   │   └── users.js            # /api/users/* (CRUD, import/export)
│   ├── scripts/                # Utility scripts
│   ├── tests/                  # Jest unit/integration tests
│   ├── package.json
│   └── pm2.config.js           # PM2 process manager config
│
├── frontend/                   # React 19 SPA (Vite)
│   ├── index.html
│   ├── vite.config.js          # Vite + Vitest config, dev proxy to :3001
│   ├── src/
│   │   ├── main.jsx            # Router, root layout, AuthProvider
│   │   ├── App.jsx             # App shell: nav bar, sidebar, layout
│   │   ├── index.css           # Global styles
│   │   ├── context/
│   │   │   ├── AuthContext.jsx # Auth state (token, user, login/logout)
│   │   │   └── ToastContext.jsx
│   │   ├── lib/
│   │   │   ├── backendOrigin.js# Resolves backend base URL
│   │   │   └── timezone.js     # Date formatting helpers
│   │   ├── components/         # Shared UI components
│   │   └── pages/              # Route-level page components
│   ├── e2e/                    # Playwright end-to-end tests
│   └── package.json
│
├── scripts/                    # Install / deploy shell scripts
├── VERSION                     # App version string (read by backend)
└── DEVELOPER_GUIDE.md          # This file
```

---

## 3. Technology Stack

### Backend

| Package | Version | Purpose |
|---|---|---|
| **express** | ^5.1.0 | HTTP framework |
| **pg** | ^8.16.3 | PostgreSQL client (connection pool) |
| **jsonwebtoken** | ^9.0.2 | JWT creation / verification |
| **bcrypt** | ^6.0.0 | Password hashing |
| **multer** | ^2.0.2 | Multipart file uploads |
| **sharp** | ^0.33.5 | Image processing (avatar resize) |
| **xlsx** | ^0.18.5 | Excel import/export |
| **cors** | ^2.8.5 | CORS middleware |
| **cookie-parser** | ^1.4.7 | Parse httpOnly refresh-token cookie |
| **node-cron** | ^3.0.2 | Cron-based background jobs |
| **prom-client** | ^14.0.1 | Prometheus metrics at `/metrics` |
| **dotenv** | ^17.2.3 | `.env` loading |
| **pm2** | ^6.0.13 | Process manager (production) |

### Frontend

| Package | Purpose |
|---|---|
| **react** / **react-dom** ^19 | UI framework |
| **react-router-dom** ^7 | Client-side routing |
| **axios** | HTTP client |
| **framer-motion** | Animation |
| **chart.js** + **react-chartjs-2** | Charts (Financial page) |
| **react-icons** | Icon library (FaXxx, FiXxx) |
| **vite** | Build tool / dev server |
| **vitest** | Unit tests |
| **@playwright/test** | E2E tests |

---

## 4. Environment Setup

### Prerequisites

- **Node.js** ≥ 18 LTS
- **PostgreSQL** ≥ 14
- `npm` or `pnpm/yarn` (project uses npm)

### Backend `.env` file

Create `backend/.env` (or project-root `.env`). The backend searches for `.env` at `backend/.env` first, then project root:

```env
# Required
DB_HOST=localhost
DB_PORT=5432
DB_USER=pguser
DB_PASSWORD=secret
DB_DATABASE=cmp

# Required (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=<random 64-byte hex string>

# Optional
PORT=3001                    # HTTP listen port (can also be set via DB app_settings)
NODE_ENV=production          # Suppresses debug logging
VERBOSE_HTTP_LOG=0           # Set to 1 to enable verbose request logging
START_TELEGRAM_BOT=true      # Set to false to disable Telegram bot on startup

# Telegram (optional)
TELEGRAM_BOT_TOKEN=<token>
```

### Database Setup

```bash
# 1. Create the database
createdb cmp

# 2. Run migrations (sequential SQL files)
cd backend
npm run migrate          # runs run_migrations.js → applies all migrations in order

# 3. Seed the initial admin account
npm run seed-admin       # or combined: npm run setup-db

# 4. (Optional) Seed servers and users for development
node seedServers.js
node seedUsers.js
```

Migration files are in `backend/migrations/` numbered 000–022. They are applied in numeric order. The migration runner tracks applied files to avoid re-running.

### Install Dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install
```

### Running in Development

```bash
# Terminal 1 – backend
cd backend
node index.js           # or: npx nodemon index.js

# Terminal 2 – frontend
cd frontend
npm run dev             # Vite dev server on :5173, proxies /api → :3001
```

The Vite dev proxy is configured in `frontend/vite.config.js`:
```js
proxy: {
  '/api': { target: 'http://localhost:3001', changeOrigin: true }
}
```

---

## 5. Database Schema

All tables are created by the numbered migration files in `backend/migrations/`. Below is a summary of every table.

### `admins` — Staff accounts

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | Auto-increment |
| `display_name` | varchar(255) | Friendly name shown in UI |
| `username` | varchar(255) | Login username (unique) |
| `password_hash` | varchar(255) | bcrypt hash |
| `role` | varchar(50) | `ADMIN` / `SERVER_ADMIN` / `VIEWER` |
| `avatar_url` | text | Path to uploaded avatar file |
| `avatar_data` | text | Base64 avatar data (legacy fallback) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `last_seen` | timestamp | Last activity |

> Constraint: `role IN ('ADMIN', 'SERVER_ADMIN', 'VIEWER')`

### `servers` — Proxy servers

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `server_name` | varchar(255) | Display name |
| `owner` | varchar(255) | Owner label |
| `service_type` | varchar(100) | e.g., "Outline", "SingBox" |
| `ip_address` | varchar(45) | IPv4 or IPv6 |
| `domain_name` | varchar(255) | Public domain |
| `api_key` | varchar(500) | Optional external API key |
| `display_pos` | integer | Sort order on dashboard/list |
| `created_at` | timestamptz | |

### `users` — Subscription users (per server)

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `account_name` | varchar(255) | Username/identifier |
| `service_type` | varchar(100) | `Mini` / `Basic` / `Unlimited` |
| `contact` | varchar(100) | Contact info |
| `expire_date` | date | Subscription expiry (date-only, no time) |
| `total_devices` | integer | Max concurrent devices |
| `data_limit_gb` | integer | Data cap (NULL for Unlimited) |
| `server_id` | integer FK → servers | |
| `remark` | text | Free-form notes |
| `display_pos` | integer | Sort order within server |
| `enabled` | boolean | Soft-disable without deletion |
| `created_at` | timestamptz | |

### `app_settings` — Key-value configuration store

Stores JSON blobs keyed by `settings_key`. Known keys:

| Key | Description |
|---|---|
| `general` | App title, theme, logo, timezone, pricing, auto-logout |
| `database` | DB connection parameters |
| `panel` | Panel port |
| `control` | Remote control settings |
| `telegram` | Telegram bot config |

### `active_sessions` — Online indicator

| Column | Type | Notes |
|---|---|---|
| `admin_id` | integer FK | |
| `token_jti` | text | JWT JTI claim |
| `last_activity` | timestamptz | Updated on activity |

An account is shown as "online" when `last_activity > NOW() - INTERVAL '60 minutes'`.

### `invalidated_tokens` — Token blocklist

Stores JTI values of tokens that were explicitly logged out before expiry.

### `refresh_tokens` — Long-lived refresh tokens

| Column | Type | Notes |
|---|---|---|
| `token_hash` | text | SHA-256 of the actual token |
| `admin_id` | integer FK | |
| `expires_at` | timestamptz | 30-day lifetime |

Actual token is stored in an `httpOnly` cookie (`refresh_token`).

### `login_audit` — Login history

Records each login event with optional fields: `ip`, `user_agent`, `geo_city`, `geo_country`, `location`, `role_at_login`.

### `server_admin_permissions` — SERVER_ADMIN assignments

| Column | Type |
|---|---|
| `admin_id` | integer FK → admins |
| `server_id` | integer FK → servers |

### `viewer_server_permissions` — VIEWER assignments

Same structure as `server_admin_permissions` (`editor_id` instead of `admin_id`).

### `server_keys` — Per-server access keys

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `server_id` | integer FK | |
| `user_id` | integer FK → users | Optional user assignment |
| `description` | text | Label |
| `key_value` | text | The actual key string |
| `prefix` | text | Optional URL prefix |
| `suffix_type` | varchar | `username` / `custom` |
| `custom_suffix` | text | |
| `created_at` | timestamptz | |

### `domains` — Domain pool

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `domain` | text | Domain name |
| `server` | text | Region code (SG, HK, US…) |
| `service` | text | `Basic` / `Premium` |
| `unlimited` | boolean | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### `monthly_financial_snapshots`

| Column | Type | Notes |
|---|---|---|
| `id` | integer PK | |
| `month` | varchar | `YYYY-MM` |
| `admin_id` | integer FK | The account snapshot is for |
| `snapshot_data` | jsonb | Revenue breakdown |
| `created_at` | timestamptz | |

### Other tables

| Table | Purpose |
|---|---|
| `admins_audit` | Audit log for admin record changes (trigger-driven) |
| `control_panel_audit` | Admin panel action log |
| `settings_audit` | App settings change log |
| `telegram_chat_notifications` | Telegram chat subscriptions |
| `telegram_login_notify_audit` | Telegram notification history |
| `password_reset_audit` | Password change events |
| `server_keys_audit` | Key create/update/delete log |

---

## 6. Backend Architecture

### Entry Points

| File | Role |
|---|---|
| `backend/index.js` | Creates the HTTP server, resolves port (DB → env → 3001), starts schedulers and Telegram bot |
| `backend/app.js` | Configures Express: CORS, cookie-parser, body parsers, static files, route mounting, SPA fallback |
| `backend/db.js` | Creates `pg.Pool`, applies per-connection `SET TIME ZONE` from `app_settings`, exports the pool |

### Startup Sequence (`index.js`)

1. Resolve port from DB `app_settings` → `process.env.PORT` → default 3001
2. `app.listen(port)`
3. Preload `settingsCache.refreshAll()` — loads general settings into memory
4. `sessionCleanup.startSessionCleanup()` — cron to purge stale `active_sessions`
5. `snapshotScheduler.startSnapshotScheduler()` — cron for auto monthly snapshots
6. Start Telegram bot (unless `START_TELEGRAM_BOT=false`)

### Route Mounting (`app.js`)

```
/api/auth         → routes/auth.js
/api/servers      → routes/servers.js
/api/users        → routes/users.js
/api/admin        → routes/admin.js
/api/domains      → routes/domains.js
/api/keyserver    → routes/keyserver.js
/uploads          → express.static (backend/public/uploads/)
/logos            → express.static (backend/public/logos/)
/metrics          → prom-client default metrics
/api/health       → inline handler (returns version, matview status)
```

Special inline endpoints in `app.js`:
- `GET /api/admin/my-server-admins` — returns current user's server-admin assignments
- `GET /api/my-server-admins` — alias of the above
- `GET /api/admin/permissions/me` — viewer server permission list
- `GET /api/admin/permissions/:editorId` — admin reads a specific editor's permissions

### Body Parser Setup

Admin routes (`/api/admin`) use `raw-body` with a **200 MB** limit to handle large backup imports before the global `express.json()` runs. The global parser also uses `200mb` as a safety net.

### SPA Fallback

In production, the built Vite frontend (`frontend/dist/`) is served directly by the backend. Any non-`/api`, non-`/uploads`, non-`/metrics` `GET` returns `index.html` to support client-side routing.

---

## 7. Authentication & Authorization

### JWT

- **Secret:** `process.env.JWT_SECRET` (required)
- **Expiry:** 24 hours
- **Payload:** `{ user: { id, role }, jti }`
- **JTI:** Random 12-byte hex string, stored in `active_sessions` and checked against `invalidated_tokens` on each request

### Middleware Functions (`backend/middleware/authMiddleware.js`)

| Middleware | Role |
|---|---|
| `authenticateToken` | Verifies JWT, attaches `req.user = { id, role }`. Checks `invalidated_tokens` for revoked JWTs. |
| `isAdmin` | Re-queries DB for current role; rejects unless `ADMIN`. Use after `authenticateToken`. |
| `isAdminOrServerAdmin` | Allows `ADMIN` or `SERVER_ADMIN` roles. |
| `isServerAdminOrGlobal(paramName)` | Allows `ADMIN` unconditionally; requires a matching row in `server_admin_permissions` for `SERVER_ADMIN`. Used for per-server operations. |

### Token Flow

1. `POST /api/auth/login` — validates credentials, signs JWT, creates `active_sessions` row, sets `refresh_token` httpOnly cookie (SHA-256-hashed, 30-day expiry), returns `{ token }`.
2. Client sends `Authorization: Bearer <token>` on every protected request.
3. `POST /api/auth/invalidate` — adds the token's JTI to `invalidated_tokens`; client discards the token.
4. Refresh token endpoint (if implemented) reads the cookie, validates hash against `refresh_tokens` table, and issues a new JWT.

### Password Hashing

bcrypt with **10 salt rounds**.

---

## 8. REST API Reference

All endpoints are prefixed with `/api`. Protected endpoints require `Authorization: Bearer <token>`.

### Auth — `/api/auth`

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/api/auth/register` | Public | — | Register a new admin (should be restricted in production) |
| `POST` | `/api/auth/login` | Public | — | Authenticate; returns `{ token }` |
| `POST` | `/api/auth/invalidate` | Bearer | Any | Invalidate current token (server-side logout) |

**`POST /api/auth/login` — Request body:**
```json
{ "username": "admin", "password": "secret" }
```
**Response:**
```json
{ "token": "<jwt>" }
```

---

### Servers — `/api/servers`

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/servers` | Bearer | Any | List all servers (ADMIN: all; VIEWER: assigned only) |
| `GET` | `/api/servers/summary` | Bearer | Any | Dashboard aggregates (server list + tier/status totals) |
| `POST` | `/api/servers` | Bearer | ADMIN | Create a new server |
| `PUT` | `/api/servers/:id` | Bearer | ADMIN | Update a server |
| `DELETE` | `/api/servers/:id` | Bearer | ADMIN | Delete a server |
| `PATCH` | `/api/servers/reorder` | Bearer | ADMIN | Update `display_pos` for multiple servers |
| `GET` | `/api/servers/:id` | Bearer | Any | Get single server details |

**`GET /api/servers/summary` — Response (abbreviated):**
```json
{
  "totalServers": 4,
  "totalUsers": 120,
  "tiers": { "Mini": 40, "Basic": 50, "Unlimited": 30 },
  "status": { "active": 100, "soon": 5, "expired": 15 },
  "servers": [
    {
      "id": 1, "server_name": "SG-01", "ip_address": "1.2.3.4",
      "total_users": 30,
      "tiers": { "Mini": 10, "Basic": 15, "Unlimited": 5 },
      "status": { "active": 25, "soon": 2, "expired": 3 }
    }
  ]
}
```

---

### Users — `/api/users`

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/users/server/:serverId` | Bearer | Any | List all users on a server |
| `POST` | `/api/users` | Bearer | ADMIN / SERVER_ADMIN | Create a user |
| `PUT` | `/api/users/:userId` | Bearer | ADMIN / SERVER_ADMIN | Update a user |
| `DELETE` | `/api/users/:userId` | Bearer | ADMIN / SERVER_ADMIN | Delete a user |
| `PATCH` | `/api/users/:userId/enabled` | Bearer | ADMIN / SERVER_ADMIN | Toggle enabled/disabled |
| `PATCH` | `/api/users/:userId/renew` | Bearer | ADMIN / SERVER_ADMIN | Quick-renew (extend expiry) |
| `GET` | `/api/users/server/:serverId/template` | Bearer | ADMIN / SERVER_ADMIN | Download XLSX import template |
| `GET` | `/api/users/server/:serverId/export` | Bearer | ADMIN / SERVER_ADMIN | Export users as XLSX |
| `POST` | `/api/users/server/:serverId/import` | Bearer | ADMIN / SERVER_ADMIN | Import users from XLSX (`?mode=merge\|overwrite`) |
| `GET` | `/api/users/search` | Bearer | Any | Search users across all accessible servers |
| `POST` | `/api/users/transfer` | Bearer | ADMIN / SERVER_ADMIN | Move one or more users to a different server |
| `GET` | `/api/users/server/:serverId/keys` | Bearer | Any | List keys for a server |
| `POST` | `/api/users/server/:serverId/keys` | Bearer | ADMIN / SERVER_ADMIN | Create a key |
| `PUT` | `/api/users/keys/:keyId` | Bearer | ADMIN / SERVER_ADMIN | Update a key |
| `DELETE` | `/api/users/keys/:keyId` | Bearer | ADMIN / SERVER_ADMIN | Delete a key |

**Create User — Request body (`POST /api/users`):**
```json
{
  "account_name": "alice",
  "service_type": "Basic",
  "contact": "alice@example.com",
  "expire_date": "2026-12-31",
  "total_devices": 2,
  "data_limit_gb": 100,
  "server_id": 1,
  "remark": "VIP customer"
}
```

**Transfer Users — Request body (`POST /api/users/transfer`):**
```json
{
  "userIds": [101, 102, 103],
  "targetServerId": 5
}
```

> ⚠️ **`targetServerId` is an ID from the `servers` table — NOT from the `domains` table.**
> Fetch valid server IDs from `GET /api/servers`. Do NOT use IDs from `GET /api/domains`; those are domain-pool entries and are different records in a different table.

Response:
```json
{
  "msg": "Successfully transferred 3 user(s)",
  "transferred": 3,
  "users": [...]
}
```

Error responses:
| Status | Message | Cause |
|---|---|---|
| 400 | `Invalid target server ID` | `targetServerId` is missing, null, or not a number |
| 404 | `Target server not found` | No row in `servers` with that ID |
| 403 | `You do not have permission to transfer users to this server` | SERVER_ADMIN does not have `server_admin_permissions` entry for target |
| 403 | `You do not have permission to transfer users from some of the source servers` | SERVER_ADMIN doesn't manage the source server(s) |

Authorization rules:
- **ADMIN**: can transfer any users between any servers.
- **SERVER_ADMIN**: must hold a `server_admin_permissions` row for **both** the target server AND every source server (the current `server_id` of each transferred user).

How to look up a server ID:
1. Call `GET /api/servers` — returns array of `{ id, server_name, ip_address, ... }`.
2. Match by `server_name` (e.g. `"VChannel Premium"`) to get `id`.
3. Pass that `id` as `targetServerId`.

---

**Import XLSX — `POST /api/users/server/:serverId/import`:**
- `Content-Type: multipart/form-data`
- File field name: `file`
- Query param: `?mode=merge` (default) or `?mode=overwrite`
- Required column: `account_name`
- Optional columns: `service_type`, `contact`, `expire_date`, `total_devices`, `data_limit_gb`, `remark`

**Rate limiting:** Import and export endpoints are limited to **10 requests per minute per user** via an in-memory bucket.

---

### Admin — `/api/admin`

#### Accounts

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/accounts` | Bearer | ADMIN | List all accounts (includes online status) |
| `GET` | `/api/admin/accounts/me` | Bearer | Any | Current user's own account |
| `GET` | `/api/admin/accounts/:id` | Bearer | ADMIN | Single account |
| `POST` | `/api/admin/accounts` | Bearer | ADMIN | Create account (multipart; `avatar` file optional) |
| `PUT` | `/api/admin/accounts/:id` | Bearer | ADMIN | Update account |
| `DELETE` | `/api/admin/accounts/:id` | Bearer | ADMIN | Delete account |
| `GET` | `/api/admin/public/accounts/:id/avatar` | Public | — | Get avatar URL or data for an account |
| `GET` | `/api/admin/ping` | Bearer | Any | Token validation ping |

**Create/update account — form fields:**

| Field | Description |
|---|---|
| `display_name` | Required |
| `username` | Required on create |
| `password` | Required on create |
| `role` | `ADMIN` / `SERVER_ADMIN` / `VIEWER` |
| `avatar` | File (`.jpg`, `.png`, `.gif`; max 5MB) |
| `clear_avatar` | `1` to remove existing avatar |

#### Settings

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/public/settings/general` | Public | — | Read general settings (safe subset; no secrets) |
| `GET` | `/api/admin/settings/:key` | Bearer | ADMIN | Read a settings group |
| `PUT` | `/api/admin/settings/:key` | Bearer | ADMIN | Write a settings group |
| `POST` | `/api/admin/settings/general/logo` | Bearer | ADMIN | Upload logo (1x) |
| `POST` | `/api/admin/settings/general/logo2x` | Bearer | ADMIN | Upload logo (2x) |
| `POST` | `/api/admin/settings/general/favicon` | Bearer | ADMIN | Upload favicon |
| `POST` | `/api/admin/settings/general/apple-touch-icon` | Bearer | ADMIN | Upload Apple Touch Icon |
| `DELETE` | `/api/admin/settings/general/logo` | Bearer | ADMIN | Remove logo |
| `POST` | `/api/admin/settings/database/test` | Bearer | ADMIN | Test DB connection with provided params |

Known `settings_key` values: `general`, `database`, `panel`, `control`, `telegram`.

#### Permissions

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/permissions/me` | Bearer | Any | Current user's assigned viewer server IDs |
| `GET` | `/api/admin/permissions/:editorId` | Bearer | ADMIN | Server IDs assigned to an editor |
| `POST` | `/api/admin/permissions/:editorId` | Bearer | ADMIN | Set server assignments for a viewer |
| `GET` | `/api/admin/my-server-admins` | Bearer | Any | Current user's SERVER_ADMIN assignments |
| `POST` | `/api/admin/server-admin-permissions/:adminId` | Bearer | ADMIN | Set SERVER_ADMIN assignments |

#### Audit & Reporting

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/audit/:accountId` | Bearer | ADMIN | Login audit logs for an account |
| `GET` | `/api/admin/financial` | Bearer | ADMIN / SERVER_ADMIN | Financial data (monthly revenue) |
| `POST` | `/api/admin/financial/snapshot` | Bearer | ADMIN | Generate monthly revenue snapshot |
| `GET` | `/api/admin/matviews` | Bearer | ADMIN | Materialized view status |
| `POST` | `/api/admin/matviews/refresh` | Bearer | ADMIN | Trigger matview refresh |

#### Backup / Restore

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/admin/backup` | Bearer | ADMIN | Export entire DB as JSON |
| `POST` | `/api/admin/restore` | Bearer | ADMIN | Restore DB from JSON backup |

**Backup format:** A JSON object containing arrays for each table (`servers`, `users`, `admins`, `domains`, etc.) plus the keyserver config.

#### Change Password

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/api/admin/change-password` | Bearer | Any | Change own password |

Request body: `{ "oldPassword": "...", "newPassword": "..." }`

---

### Domains — `/api/domains`

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/domains` | Bearer | ADMIN | List all domains |
| `POST` | `/api/domains` | Bearer | ADMIN | Add a domain |
| `PUT` | `/api/domains/:id` | Bearer | ADMIN | Update a domain |
| `DELETE` | `/api/domains/:id` | Bearer | ADMIN | Delete a domain |
| `POST` | `/api/domains/batch-delete` | Bearer | ADMIN | Bulk delete domains |
| `GET` | `/api/domains/list` | Bearer | Any | Public domain list (for config generators) |

**Create domain — request body:**
```json
{
  "domain": "sg.example.com",
  "server": "SG",
  "service": "Basic",
  "unlimited": false
}
```

---

### Key Server — `/api/keyserver`

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/api/keyserver/config` | Bearer | ADMIN / SERVER_ADMIN | Read key server config |
| `PUT` | `/api/keyserver/config` | Bearer | ADMIN | Save key server config |
| `POST` | `/api/keyserver/generate-key` | Bearer | ADMIN | Generate a new random secret key |
| `GET` | `/api/keyserver/status` | Bearer | ADMIN / SERVER_ADMIN | Runtime status (`stopped` / `running` / `error`) |
| `POST` | `/api/keyserver/start` | Bearer | ADMIN | Start key server |
| `POST` | `/api/keyserver/stop` | Bearer | ADMIN | Stop key server |
| `POST` | `/api/keyserver/restart` | Bearer | ADMIN | Restart key server |
| `GET` | `/api/keyserver/keys` | Bearer | ADMIN / SERVER_ADMIN | List config files in `configDir` |
| `POST` | `/api/keyserver/keys` | Bearer | ADMIN | **Upload / save a config file** (JSON body) |
| `GET` | `/api/keyserver/keys/:filename/content` | Bearer | ADMIN / SERVER_ADMIN | Read file content |
| `DELETE` | `/api/keyserver/keys/:filename` | Bearer | ADMIN | Delete a config file |
| `POST` | `/api/keyserver/keys/batch-delete` | Bearer | ADMIN | Bulk delete files (`{ "filenames": [...] }`) |
| `GET` | `/api/keyserver/backup` | Bearer | ADMIN | Download all config files as `.zip` |
| `POST` | `/api/keyserver/restore` | Bearer | ADMIN | Restore config files from `.zip` |

> ⚠️ **Common mistake:** The file management endpoints are under **`/api/keyserver/keys`**, NOT `/api/keyserver/files`. Using `/files/...` paths will return **404 Not Found**.

**`POST /api/keyserver/keys` — Upload a config file:**

This is the correct endpoint for bots/scripts to save a JSON or YAML config file to the key server. Send a JSON body:

```http
POST /api/keyserver/keys
Authorization: Bearer <admin-jwt-token>
Content-Type: application/json

{
  "filename": "myuser-config.json",
  "content": "{\"log\":{},\"outbounds\":[...]}",
  "metadata": {
    "upload-traffic": 1073741824,
    "download-traffic": 5368709120,
    "total": 107374182400,
    "expire": 1767225600
  }
}
```

**Response:**
```json
{
  "message": "File saved",
  "filename": "myuser-config.json",
  "token": "a3f9b1c2d4e5f6a7b8c9d0e1f2a3b4c5"
}
```

- `filename` — the sanitized name actually stored on disk (only `a-z A-Z 0-9 . _ -` allowed; unsupported chars become `-`)
- `content` — the full file content as a **string** (stringify your JSON first)
- `metadata` — optional; saved as a companion `.meta.json` for subscription-userinfo headers (Clash-compatible)
- `token` — the per-file access token for the public key server URL

The public URL clients use to fetch the config:
```
http://<publicDomain>:<keyServerPort>/files/<filename>?token=<token>
```

#### Key Server File Serving

When the key server is running, it serves files at:
```
http://<publicDomain>:<port>/files/<filename>?token=<token>
```
The `token` is a per-file random 32-hex string stored in `data/token_map.json`. Requests without a valid token receive HTTP 403.

---

### Health — `/api/health`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Returns version, build info, matview status |

**Response:**
```json
{
  "status": "ok",
  "versions": {
    "appVersion": "1.8.3",
    "gitSha": "abc123",
    "buildTimestamp": "2026-03-01T00:00:00Z"
  }
}
```

---

### Metrics — `/metrics`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/metrics` | Public | Prometheus metrics (default Node.js metrics + custom gauges) |

Custom gauge: `cmp_telegram_bot_up` — 1 if bot is running, 0 if down.

---

## 9. Frontend Architecture

### Entry Point (`src/main.jsx`)

Sets up `createBrowserRouter` with a root `<Root>` element that wraps everything in `<AuthProvider>`. Route guards use `<ProtectedRoute>`, `<AdminOnlyRoute>`, and `<AdminOrServerAdminRoute>`.

### Route Tree

```
/login                        → LoginPage (public)
/                             → ProtectedRoute (requires token)
  └── App (layout shell)
       ├── /                  → DashboardPage
       ├── /financial         → FinancialPage
       ├── /search            → SearchPage
       ├── /yaml-generator    → YamlGeneratorPage
       ├── /json-generator    → JsonGeneratorPage
       ├── /server-list       → ServerListPage
       ├── /key-manager       → AdminOrServerAdminRoute
       │    └── /             → KeyManagerPage
       ├── /domain-manager    → AdminOnlyRoute
       │    └── /             → DomainManagerPage
       ├── /settings          → AdminOnlyRoute
       │    └── /             → SettingsPage
       ├── /servers/:id       → ServerDetailPage
       ├── /servers/:id/keys  → KeyManagementPage
       └── /admin             → AdminOnlyRoute
            └── /             → AdminPanelPage
```

### `src/lib/backendOrigin.js`

Resolves the backend base URL at runtime. In production (same-origin), returns an empty string `""` so API paths become relative. In development (different port), returns `http://localhost:3001`.

### `src/lib/timezone.js`

- `formatWithAppTZ(isoString)` — formats a date/time using the app's configured timezone (read from `localStorage`)
- `getStoredTimezone()` — reads the stored timezone key
- `isSameDayInAppTZ(a, b)` — compares two dates in app timezone

---

## 10. Frontend Pages Reference

### `LoginPage` (`/login`)

- `POST /api/auth/login`
- Stores JWT in `localStorage('token')` and user payload in `localStorage('user')`
- Calls `login(token, user)` from `AuthContext`
- Theme toggle on login page writes to `localStorage('themeOverride')`

### `DashboardPage` (`/`)

- `GET /api/servers/summary` — loads all server/user aggregates
- `GET /api/health` — checks matview refresh status
- Auto-refreshes on a configurable interval (default 30s, stored in `localStorage('dashboardRefreshInterval')`)
- Clicking status/tier badges opens a modal listing the relevant users

### `ServerListPage` (`/server-list`)

- `GET /api/servers`
- Renders `<ServerList>` and `<AddServerForm>` for ADMIN
- Drag-and-drop reorder: `PATCH /api/servers/reorder`
- Shows `<UserTransferModal>` for bulk user moves between servers

### `ServerDetailPage` (`/servers/:id`)

- `GET /api/users/server/:id` — users list
- `GET /api/servers/:id` — server info
- Filter/search on client side
- Export: `GET /api/users/server/:id/export`
- Import: `POST /api/users/server/:id/import` (with `<ImportModeModal>` for merge/overwrite choice)
- Links to `/servers/:id/keys` for key management

### `KeyManagementPage` (`/servers/:id/keys`)

- `GET /api/users/server/:id/keys`
- `POST /api/users/server/:id/keys`
- `PUT /api/users/keys/:keyId`
- `DELETE /api/users/keys/:keyId`
- Key form includes prefix toggle, suffix type (username / custom), and user assignment

### `KeyManagerPage` (`/key-manager`)

- Manages the built-in key server (start/stop/config) and the config file list
- `GET/POST /api/keyserver/config`
- `GET /api/keyserver/status`
- `GET /api/keyserver/files`
- Backup: `GET /api/keyserver/backup` (downloads zip)
- Restore: `POST /api/keyserver/restore` (uploads zip)

### `SearchPage` (`/search`)

- `GET /api/users/search?q=...`
- Quick-renew inline via `PATCH /api/users/:id/renew`

### `FinancialPage` (`/financial`)

- `GET /api/admin/financial[?userId=...]`
- Bar chart of monthly revenue via Chart.js
- Date range filter, user selector (ADMIN only)
- Generate snapshot: `POST /api/admin/financial/snapshot`

### `YamlGeneratorPage` (`/yaml-generator`)

- Generates Clash-compatible YAML in the browser (no API call for generation)
- Fetches domain list: `GET /api/domains/list`
- Fetches user list for autocomplete: `GET /api/users/search`
- Saves prefix/suffix settings to `localStorage`

### `JsonGeneratorPage` (`/json-generator`)

- Same as YAML Generator but produces sing-box JSON format
- Additional: SS prefix obfuscation option, also-save-as-TXT option

### `DomainManagerPage` (`/domain-manager`)

- `GET/POST/PUT/DELETE /api/domains`
- Batch delete: `POST /api/domains/batch-delete`
- Inline row editing; sortable columns

### `AdminPanelPage` (`/admin`)

- `GET /api/admin/accounts` — account list
- Create/edit via `<AdminEditorForm>`
- Audit logs: `GET /api/admin/audit/:accountId`
- Export: `GET /api/admin/backup`
- Import: `POST /api/admin/restore`
- `<MatviewStatus>` component shows materialized view health

### `SettingsPage` (`/settings`)

- Tabs: `database`, `general`, `control`
- `GET/PUT /api/admin/settings/:key`
- Logo upload: `POST /api/admin/settings/general/logo`
- DB test: `POST /api/admin/settings/database/test`

### `ChangePasswordPage` (`/change-password`)

- Wraps `<ChangePassword>` component
- `POST /api/admin/change-password`

---

## 11. Frontend Components Reference

### Route Guards

| Component | File | Behavior |
|---|---|---|
| `ProtectedRoute` | `components/ProtectedRoute.jsx` | Redirects to `/login` if no JWT token |
| `AdminOnlyRoute` | `components/AdminOnlyRoute.jsx` | Redirects to `/` if role ≠ ADMIN |
| `AdminOrServerAdminRoute` | `components/AdminOrServerAdminRoute.jsx` | Redirects to `/` unless ADMIN or SERVER_ADMIN |

### Forms & Modals

| Component | Purpose | Key Props |
|---|---|---|
| `AdminEditorForm` | Create / edit staff accounts | `isOpen`, `account`, `servers`, `onSaved`, `onClose` |
| `AddUserForm` | Add a user to a server | `serverId`, `onUserAdded`, `onClose` |
| `EditUserModal` | Edit an existing user | `user`, `onClose`, `onSave` |
| `AddServerForm` | Add a server | `onServerAdded`, `onCancel` |
| `EditServerModal` | Edit a server | `server`, `onClose`, `onSave` |
| `UserTransferModal` | Bulk-transfer users between servers | `isOpen`, `onClose`, `servers`, `onTransferComplete` |
| `ImportModeModal` | Choose merge / overwrite for import | `isOpen`, `onClose`, `onSelect` |
| `ConfirmModal` | Generic confirmation dialog | `isOpen`, `onClose`, `onConfirm`, `title`, `confirmLabel` |
| `Modal` | Base modal shell | `isOpen`, `onClose`, `title`, `compact`, `actions` |
| `InfoModal` | Read-only info dialog | `isOpen`, `onClose`, `title` |

### Data Display

| Component | Purpose |
|---|---|
| `UserTable` | Paginated user table with sort, edit, delete, enable-toggle, quick-renew |
| `ServerList` | Paginated server list with reorder drag-and-drop |
| `MatviewStatus` | Shows DB materialized view status; allows manual refresh |
| `GlassSelect` | Accessible custom `<select>` dropdown with keyboard navigation |
| `UserEnabledToggle` | Inline enable/disable toggle; sends `PATCH /api/users/:id/enabled` |

### Feedback & UX

| Component | Purpose |
|---|---|
| `Toast` / `ToastContext` | Context-based toast notifications (success / error / info) |
| `IdleToast` | Session expiry warning banner with countdown and extend button |
| `TopProgressBar` | Thin indeterminate progress bar at top of page |
| `BackToTop` | Scroll-to-top button (appears after 200px scroll) |
| `AboutModal` | Shows app version, Git SHA, build time |

---

## 12. State Management & Context

### `AuthContext` (`src/context/AuthContext.jsx`)

```jsx
const { token, user, login, logout } = useAuth();
```

- `token` — raw JWT string from `localStorage('token')`
- `user` — decoded JWT payload (`{ user: { id, role } }` or direct `{ id, role }`)
- `login(token, user)` — stores token, sets state
- `logout()` — clears localStorage, calls `POST /api/auth/invalidate`, redirects to `/login`

The context also handles the **idle auto-logout timer**:
- Reads `autoLogoutMinutes` from `localStorage` (set by the backend during login from `app_settings.general`)
- Fires a `window` custom event `idle-warning` with `remainingMs` before logout
- `App.jsx` listens to `idle-warning` and shows `<IdleToast>`

### `ToastContext` (`src/context/ToastContext.jsx`)

```jsx
const { show } = useToast();
show('User saved', 'success');   // 'success' | 'error' | 'info'
```

Toast duration default: **3500 ms**.

---

## 13. Key Server (Built-in HTTP File Server)

The Key Server is a second Express instance created **inside the main backend process** (`backend/routes/keyserver.js`). It serves subscription config files to end-user apps (Clash, V2Box, sing-box, etc.).

### Config (`backend/data/keyserver.json`)

```json
{
  "port": 8088,
  "secretKey": "",
  "configDir": "/srv/cmp/configs",
  "autoStart": false,
  "publicDomain": "https://keys.example.com"
}
```

### File Access Control

Each file gets a unique **token** (random 32-hex string) stored in `backend/data/token_map.json`. The public URL format is:

```
http://<publicDomain>:<port>/files/<filename>?token=<token>
```

Requests without the correct token receive HTTP 403.

### Config File → URI Conversion

The key server can dynamically convert **sing-box JSON** outbound objects into standard proxy URIs (vmess://, vless://, trojan://, ss://) for cross-client compatibility. This conversion runs on-the-fly when a client requests a file.

---

## 14. Background Jobs & Schedulers

All schedulers use `node-cron` and are started from `backend/index.js`.

### Session Cleanup (`lib/sessionCleanup.js`)

- Runs every **15 minutes**
- Deletes rows from `active_sessions` where `last_activity < NOW() - INTERVAL '2 hours'`

### Snapshot Scheduler (`lib/snapshotScheduler.js`)

- Runs at **00:05 on the 1st of every month**
- Automatically generates `monthly_financial_snapshots` for the previous month for each account
- Prevents duplicate snapshots (checks before inserting)

### Materialized View Refresh (`lib/matview_refresh.js`)

- Queue-based system: enqueue a refresh → worker runs `REFRESH MATERIALIZED VIEW CONCURRENTLY user_status_matview`
- Triggered after bulk imports (to reflect new user statuses quickly)
- Can be triggered manually from the Admin Panel UI

`lib/matview_detect.js` — checks whether the materialized view actually exists in the DB before attempting to use it (graceful fallback if the view is not present).

---

## 15. Telegram Bot Integration

File: `backend/telegram_bot.js`

Optional integration for login notifications and alerts.

### Configuration

Stored in `app_settings` under key `telegram`:
```json
{
  "botToken": "<TELEGRAM_BOT_TOKEN>",
  "chatId": "<CHAT_ID>",
  "enabled": true
}
```
Or via `TELEGRAM_BOT_TOKEN` environment variable.

### Features

- **Login notifications** — fires after a successful `/api/auth/login` (fire-and-forget)
- **Alert commands** — admins can configure the bot to accept commands via Telegram
- Errors are non-fatal: the API still returns `200 OK` even if the Telegram call fails

---

## 16. Testing

### Backend (Jest + Supertest)

```bash
cd backend
npm test             # runs all tests with --runInBand
npm run test-unit    # same as npm test
```

Test files: `backend/tests/`  
`globalTeardown`: `backend/tests/jest.teardown.js` — calls `pool.end()` to cleanly close connections.

`pg-mem` is used for in-memory PostgreSQL simulation in unit tests, avoiding the need for a live database.

### Frontend Unit Tests (Vitest)

```bash
cd frontend
npm test             # watch mode
npm run test:run     # single run (for CI)
```

Configuration in `vite.config.js`:
```js
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: 'src/test.setup.js',
  include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  exclude: ['e2e/**']
}
```

Test utilities: `@testing-library/react`, `@testing-library/user-event`, `axios-mock-adapter`, `msw`.

### End-to-End Tests (Playwright)

```bash
cd frontend
npm run test:e2e:install   # install browsers once
npm run test:e2e           # run e2e tests
```

Config: `frontend/playwright.config.js`  
Tests: `frontend/e2e/`

### CI Script

```bash
# Backend
cd backend && npm run ci       # npm test

# Frontend
cd frontend && npm run ci      # eslint + vitest run
```

---

## 17. Build & Deployment

### Production Build

```bash
# 1. Build frontend
cd frontend
npm run build
# Output: frontend/dist/

# 2. Copy or link dist → backend/public/ (or let backend serve from frontend/dist/)
# The backend auto-detects frontend/dist/ and mounts it as static + SPA fallback.

# 3. Start backend
cd backend
node index.js
# or with PM2:
pm2 start pm2.config.js --env production
```

### PM2 (`backend/pm2.config.js`)

```js
module.exports = {
  apps: [{
    name: 'cmp-backend',
    script: 'index.js',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001
    }
  }]
};
```

### Linux Service (systemd)

Systemd unit files are in `backend/systemd/`. Deployment scripts in `scripts/`:

- `scripts/install.sh` — full install on Ubuntu/Debian
- `scripts/update-vps.sh` — pull latest code, reinstall, migrate, restart service
- `scripts/service-control.sh` — start / stop / status

### Windows

- `scripts/install-windows.ps1` — PowerShell installer
- `scripts/service-control.ps1` — start / stop / status

### Nginx Reverse Proxy

Example `key.vchannel.dpdns.org.conf` (in project root):
```nginx
server {
  listen 80;
  server_name panel.example.com;
  location / {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

The `X-Forwarded-For` header is read by the backend for IP geolocation in login audit records.

---

## 18. Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_HOST` | ✅ | — | PostgreSQL host |
| `DB_PORT` | ✅ | — | PostgreSQL port |
| `DB_USER` | ✅ | — | PostgreSQL user |
| `DB_PASSWORD` | ✅ | — | PostgreSQL password |
| `DB_DATABASE` | ✅ | — | PostgreSQL database name |
| `JWT_SECRET` | ✅ | — | JWT signing secret (min 32 chars recommended) |
| `PORT` | ❌ | 3001 | HTTP listen port |
| `FORCE_BACKEND_PORT` | ❌ | — | Overrides all port sources |
| `NODE_ENV` | ❌ | `development` | Set to `production` to suppress debug logs |
| `VERBOSE_HTTP_LOG` | ❌ | `0` | Set to `1` for verbose HTTP request logging |
| `START_TELEGRAM_BOT` | ❌ | `true` | Set to `false` to disable the Telegram bot |
| `TELEGRAM_BOT_TOKEN` | ❌ | — | Telegram bot token (also configurable via DB) |

### App Settings (stored in `app_settings` table)

#### `general`

```json
{
  "title": "VChannel",
  "theme": "dark",
  "showTooltips": true,
  "logo_url": "/logos/logo.png",
  "logo_url_2x": "/logos/logo@2x.png",
  "favicon_url": "/logos/favicon.ico",
  "apple_touch_icon_url": "/logos/apple-touch-icon.png",
  "autoLogoutMinutes": 30,
  "price_mini": 500,
  "price_basic": 1000,
  "price_unlimited": 2000,
  "currency": "USD",
  "timezone": "Asia/Singapore"
}
```

Prices are stored as **cents** (integer). `autoLogoutMinutes: 0` = disabled.

#### `database`

```json
{
  "host": "localhost",
  "port": 5432,
  "user": "pguser",
  "password": "***",
  "database": "cmp",
  "ssl": false
}
```

---

## 19. Common Development Tasks

### Add a New API Endpoint

1. Choose the appropriate route file in `backend/routes/`.
2. Add the route handler with `authenticateToken` and any role-checking middleware.
3. Write a SQL query using `pool.query(...)` — always use parameterized queries (`$1`, `$2`, ...).
4. Test with Supertest in `backend/tests/`.
5. Update the frontend (`axios.get/post/put/delete`) and the relevant page component.

### Add a New Page

1. Create `frontend/src/pages/MyNewPage.jsx`.
2. Import and add a `<Route>` in `frontend/src/main.jsx`. Wrap with `<AdminOnlyRoute>` or `<AdminOrServerAdminRoute>` if restricted.
3. Add a nav link in `frontend/src/App.jsx` if it should appear in the sidebar.

### Add a New Migration

1. Create `backend/migrations/0NN-table-whatever.sql` (increment the number).
2. Write `CREATE TABLE IF NOT EXISTS ...` or `ALTER TABLE ...` with `IF NOT EXISTS` guards.
3. Run `npm run migrate` in `backend/`.
4. For rollback, the migration runner does not have automatic rollback — write and run manual down-migration SQL if needed.

### Change the App Title / Theme

In the Admin Panel → Settings → General tab → update "Application Title" and "Theme". This writes to `app_settings.general` and broadcasts a `general-settings-updated` DOM event that `App.jsx` listens to for immediate updates.

### Reset Admin Password

```bash
cd backend
node -e "
const bcrypt = require('bcrypt');
const pool = require('./db');
(async () => {
  const hash = await bcrypt.hash('newpassword', 10);
  await pool.query('UPDATE admins SET password_hash = \$1 WHERE username = \$2', [hash, 'admin']);
  console.log('Done');
  process.exit(0);
})();
"
```

### Add a New Service Tier

Service types are stored as free-text strings in `users.service_type`. The canonical values are `Mini`, `Basic`, `Unlimited`. To add a tier:

1. Update `normalizeService()` in `backend/routes/servers.js` (dashboard aggregates) and `backend/routes/users.js` (import logic).
2. Add the new option to `<GlassSelect>` in `AddUserForm.jsx` and `EditUserModal.jsx`.
3. Update pricing config in `app_settings.general`.

---

## 20. Security Notes

### What's Implemented

- **bcrypt password hashing** (10 rounds)
- **JWT with JTI blacklist** — tokens are server-side revocable via `invalidated_tokens`
- **httpOnly refresh token cookie** — not accessible to JavaScript
- **Role-based middleware** — DB role is re-validated on protected endpoints (not just trusted from JWT)
- **Parameterized SQL queries** throughout — no raw string interpolation in queries
- **Rate limiting** on import/export — 10 req/min in-memory bucket per user
- **File upload restrictions** — multer limits avatar uploads to 5 MB; import to 25 MB
- **CORS** — currently allows all origins (suitable for same-host deployments; tighten for production)
- **Content-Security headers** — none configured by default; add via nginx or a middleware like `helmet`

### Production Hardening Checklist

- [ ] Set a strong `JWT_SECRET` (≥ 64 random bytes)
- [ ] Set `NODE_ENV=production`
- [ ] Restrict Nginx to HTTPS only; use `certbot` or similar for TLS
- [ ] Set `secure: true` on the refresh token cookie (automatic when not on localhost)
- [ ] Restrict the `/api/auth/register` endpoint or remove it after initial setup
- [ ] Review the CORS policy in `app.js` if the frontend is on a different domain
- [ ] Keep PostgreSQL behind the firewall; only allow connections from the backend host
- [ ] Add `helmet` middleware for standard HTTP security headers
- [ ] Monitor `/metrics` endpoint — restrict it or move to an internal network
- [ ] Rotate `JWT_SECRET` periodically; existing tokens will be invalidated on restart

---

*For user-facing documentation see [USER_GUIDE.md](USER_GUIDE.md). For deployment steps see [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) and [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md).*

---

## 21. Bot / Automation Integration Guide

This section documents everything an external bot or automation script needs to interact with the Key Server — from one-time setup through per-user config generation and delivery.

---

### 21.1 One-Time Setup (Key Server Configuration)

Before the key server can serve any files, it must be configured with a **secret key**, a **port**, and optionally a **public domain**. These are persistent — do this once and they survive restarts.

#### Step 1 — Generate a secret key

```http
POST /api/keyserver/generate-key
Authorization: Bearer <admin-jwt-token>
```

Response:
```json
{ "key": "3f8a1c9d2e4b7f0a5c3d1e8f2a4b6c0d" }
```

The key is **32 hex characters (128 bits)** generated by `crypto.randomBytes(16)`. This is the shared secret that every VPN client must include as `?key=<value>` when fetching their config URL. Keep it private.

> If the API call fails (e.g. bot can't reach the server), you can generate a compatible key client-side:
> ```js
> const key = Array.from(crypto.getRandomValues(new Uint8Array(16)))
>   .map(b => b.toString(16).padStart(2, '0')).join('');
> ```

#### Step 2 — Save key server config

```http
PUT /api/keyserver/config
Authorization: Bearer <admin-jwt-token>
Content-Type: application/json

{
  "port": 8088,
  "secretKey": "3f8a1c9d2e4b7f0a5c3d1e8f2a4b6c0d",
  "configDir": "/srv/cmp/configs",
  "autoStart": true,
  "publicDomain": "keys.yourdomain.com"
}
```

| Field | Required | Description |
|---|---|---|
| `port` | No (default 8088) | Port the key server listens on |
| `secretKey` | **Yes** | The secret from Step 1; required to start the server |
| `configDir` | No (default `/srv/cmp/configs`) | Directory where config files are stored on disk |
| `autoStart` | No (default false) | Whether to start the key server automatically on process boot |
| `publicDomain` | No | Domain clients use in their subscription URL (e.g. `keys.example.com` or `http://keys.example.com:8088`) |

#### Step 3 — Start the key server

```http
POST /api/keyserver/start
Authorization: Bearer <admin-jwt-token>
```

Response: `{ "message": "Key server started", "status": "running" }`

> If `secretKey` is empty, you will get: `400 { "error": "Secret key is not configured" }`

#### Step 4 — Verify it is running

```http
GET /api/keyserver/status
Authorization: Bearer <admin-jwt-token>
```

Response:
```json
{ "status": "running", "error": "", "port": 8088 }
```

`status` is one of: `"stopped"` | `"running"` | `"error"`. If `"error"`, the `error` field contains the message.

---

### 21.2 Reading the Current Key Server Config

Before uploading files, the bot should read the current config to get `secretKey`, `port`, `publicDomain`, and `configDir`:

```http
GET /api/keyserver/config
Authorization: Bearer <admin-jwt-token>
```

Response:
```json
{
  "port": 8088,
  "secretKey": "3f8a1c9d2e4b7f0a5c3d1e8f2a4b6c0d",
  "configDir": "/srv/cmp/configs",
  "autoStart": true,
  "publicDomain": "keys.yourdomain.com"
}
```

Cache this response — it won't change unless an admin edits it.

---

### 21.3 Looking Up a User's Settings

When generating a config file for a specific user, the bot needs their `expire_date`, `data_limit_gb`, and `account_name` to:
- compute the correct **filename suffix**
- embed correct **expiry** in the subscription header
- embed the correct **data quota** in the subscription header

#### Search for a user by account name

```http
GET /api/users/search?q=<partial_name>
Authorization: Bearer <admin-jwt-token>
```

Minimum 2 characters required. Returns up to 100 matching users, ordered alphabetically.

Example: `GET /api/users/search?q=alice`

Response (array of user objects):
```json
[
  {
    "id": 42,
    "account_name": "Alice Johnson",
    "service_type": "Premium",
    "contact": "@alice",
    "expire_date": "2026-06-30",
    "total_devices": 3,
    "data_limit_gb": 100,
    "server_id": 5,
    "server_name": "SG-01",
    "remark": "",
    "enabled": true,
    "status": "active"
  }
]
```

> `expire_date` is always a `YYYY-MM-DD` string (date-only, no time component).
> `data_limit_gb` is a number (GB) or `null` for unlimited.
> `status` is computed: `"active"` | `"expired"` | `"soon"` | `"disabled"`.

#### Fuzzy search (optional)

Add `&fuzzy=1` to enable pg_trgm fuzzy matching. Useful when the bot receives a Telegram username that might not exactly match the stored `account_name`:

```http
GET /api/users/search?q=alic&fuzzy=1
```

---

### 21.4 Building the Filename

The filename is constructed identically to how the UI does it:

```
filename = <filePrefix>-<suffix>.<ext>
```

| Part | Value |
|---|---|
| `filePrefix` | Admin-chosen prefix stored in `localStorage` in the UI; **the bot should use a consistent prefix**, e.g. `"vchannel-config"` or any fixed string |
| `suffix` | `account_name` lowercased with spaces/underscores collapsed: `account_name.toLowerCase().replace(/[\s_]+/g, '')` |
| `ext` | `.json` for sing-box configs; `.txt` for V2Box/Clash plain-text subscription files; `.yaml` for Clash YAML |

**Examples:**

| `account_name` | Computed suffix | Full filename |
|---|---|---|
| `Alice Johnson` | `alicejohnson` | `vchannel-config-alicejohnson.json` |
| `Bob_Smith` | `bobsmith` | `vchannel-config-bobsmith.json` |
| `john doe` | `johndoe` | `vchannel-config-johndoe.txt` |

> If no suffix is provided, the UI falls back to `vchannel-config.json` / `keys.txt`.

**Filename sanitization on the server side** (you don't need to do this manually, but be aware):
- Only `a-z A-Z 0-9 . _ -` are kept; all other characters are replaced with `-`
- If no recognized extension (`.yaml`, `.yml`, `.json`, `.txt`) is present, `.yaml` is appended

---

### 21.5 Building the Subscription Metadata

Send metadata with each config file so the key server can return correct `Subscription-Userinfo` headers to Clash-compatible clients:

```json
{
  "upload": 0,
  "download": 0,
  "total": <bytes>,
  "expire": <unix_timestamp_seconds>
}
```

**Computing `total` (bytes from `data_limit_gb`):**
```js
const total = Math.round(data_limit_gb * 1073741824);
// e.g. 100 GB → 107374182400
```
If the user has `data_limit_gb = null` (unlimited), use a large number like `549755813888` (512 GB) or set `unlimited: true`.

**Computing `expire` (Unix timestamp from `expire_date`):**
```js
// expire_date is "YYYY-MM-DD" — parse as LOCAL midnight to avoid UTC off-by-one
const expire = Math.floor(new Date(expire_date + 'T00:00:00').getTime() / 1000);
// e.g. "2026-06-30T00:00:00" local → ~1751212800
```
If no expire date, use `0`.

**Full metadata object example** (for user with 100 GB / expires 2026-06-30):
```json
{
  "upload": 0,
  "download": 0,
  "total": 107374182400,
  "expire": 1751212800
}
```

The UI also stores these human-readable fields for its own display:
```json
{
  "data_limit_gb": 100,
  "expire_date": "2026-06-30"
}
```
The bot can include whichever format it prefers; what matters for the Clash `Subscription-Userinfo` header is `upload`, `download`, `total`, `expire`.

---

### 21.6 Uploading a Config File

Once you have: the filename, the config content as a string, and the metadata, save it:

```http
POST /api/keyserver/keys
Authorization: Bearer <admin-jwt-token>
Content-Type: application/json

{
  "filename": "vchannel-config-alicejohnson.json",
  "content": "{\"log\":{\"level\":\"warn\"},\"outbounds\":[...]}",
  "metadata": {
    "upload": 0,
    "download": 0,
    "total": 107374182400,
    "expire": 1751212800,
    "data_limit_gb": 100,
    "expire_date": "2026-06-30"
  }
}
```

**Response:**
```json
{
  "message": "File saved",
  "filename": "vchannel-config-alicejohnson.json",
  "token": "a3f9b1c2d4e5f6a7b8c9d0e1f2a3b4c5"
}
```

- `filename` — the sanitized name actually written to disk
- `token` — a **stable, opaque token** that maps to this file. Use it in subscription URLs so the real filename is never exposed to end users. The token persists across re-uploads of the same filename.

> `content` must be a **plain string**. If your config is a JavaScript/Python object, stringify it first:
> ```js
> content: JSON.stringify(configObject)      // for JSON
> content: yaml.dump(configObject)           // for YAML
> ```

---

### 21.7 Building the Client Subscription URL

> ⚠️ **Read this carefully — these are the most common mistakes.**

The key server has **only one public route**: `GET /sub/:id`

The correct URL is:
```
http://<publicDomain>:<port>/sub/<TOKEN>?key=<SECRETKEY>
```

| Part | What goes here | Where it comes from |
|---|---|---|
| `/sub/` | **Always `/sub/`** — there is NO `/files/` route | Hard-coded |
| `<TOKEN>` | The opaque token from `POST /api/keyserver/keys` response → `.token` field | Returned after upload |
| `?key=` | Then the **Secret Key** from the key server config | `GET /api/keyserver/config` → `.secretKey` |

**Example:**
```
http://key.vchannel.dpdns.org:8088/sub/a3f9b1c2d4e5f6a7b8c9d0e1f2a3b4c5?key=3f8a1c9d2e4b7f0a5c3d1e8f2a4b6c0d
                                    ^^^                                     ^^^
                          token goes in the PATH            secret key goes as ?key=
```

**Common mistakes that will break the URL:**

| Wrong | Why it fails | Right |
|---|---|---|
| `/files/<filename>?token=<token>` | `/files/` route does not exist | `/sub/<token>?key=<secretKey>` |
| `/sub/<filename>?key=<secretKey>` | Using filename as ID instead of token (works as fallback but exposes filename) | `/sub/<token>?key=<secretKey>` |
| `?token=<token>` as query param | No such query parameter exists | `?key=<secretKey>` where value is the SECRET KEY, not the token |

**If no `publicDomain` is configured**, fall back to the server IP and port:
```
http://<server-ip>:<port>/sub/<token>?key=<secretKey>
```

**Format conversion** (optional extra query parameter):
Append `&format=<format>` to request automatic conversion by the key server:
- `&format=raw` — proxy-only sing-box JSON `{"outbounds":[...]}` containing only the proxy outbounds (shadowsocks/vmess/vless/trojan/hysteria2) — for sing-box-native clients (V2Box, NekoBox)
- `&format=v2ray` — full V2Ray/Xray JSON config — for V2RayNG local config import and Xray clients
- (no format param, for `.json` files) — auto-converts to base64-encoded proxy URI list for most subscription clients (V2Box, V2RayNG)
- (no format param, for `.txt` files) — served as-is (plain text proxy URIs)

> **Three URLs to expose after upload:**
> ```
> sub_url   = {base}/sub/{token}?key={secretKey}               ← Base64 proxy URI list
> raw_url   = {base}/sub/{token}?key={secretKey}&format=raw    ← proxy-only sing-box JSON
> v2ray_url = {base}/sub/{token}?key={secretKey}&format=v2ray  ← full V2Ray/Xray JSON
> ```
> All three use the same `.json` file token.

---

### 21.8 Complete Bot Workflow (Per-User Config Generation)

Here is the full sequence the bot should follow when a user requests their config:

```
1. GET  /api/keyserver/config
       → read port, secretKey, publicDomain (cache this)

2. GET  /api/users/search?q=<username>
       → find the user object; read:
           account_name  → used to build filename suffix
           expire_date   → "YYYY-MM-DD" or null
           data_limit_gb → number (GB) or null

3. Build filename:
       suffix   = account_name.toLowerCase().replace(/[\s_]+/g, '')
       filename = `vchannel-config-${suffix}.json`    (or .txt / .yaml)

4. Build metadata:
       total  = data_limit_gb ? Math.round(data_limit_gb * 1073741824) : 549755813888
       expire = expire_date
                  ? Math.floor(new Date(expire_date + 'T00:00:00').getTime() / 1000)
                  : 0

5. Build config content:
       Generate the sing-box / Clash / V2Box config as a string.
       Embed the expiry and data limit inside the config body if the format supports it.

6. POST /api/keyserver/keys
       body: { filename, content, metadata: { upload: 0, download: 0, total, expire, data_limit_gb, expire_date } }
       → response contains { filename, token }

7. Build subscription URL:
       //  TOKEN goes in the PATH — secretKey goes as ?key= query param
       //  DO NOT use /files/, DO NOT use ?token= — neither exists
       base    = publicDomain || `http://<server-ip>:${port}`
       token   = response from Step 6 → .token field
       url     = `${base}/sub/${token}?key=${secretKey}`
       //                   ^^^^^^              ^^^^^^^^^
       //            token in URL path     secret key, not the token!

8. Send the URL to the user (Telegram message, QR code, etc.)
```

---

### 21.9 Checking & Listing Existing Files

Before re-generating a config, the bot can check if a file already exists:

```http
GET /api/keyserver/keys
Authorization: Bearer <admin-jwt-token>
```

Response (array):
```json
[
  {
    "filename": "vchannel-config-alicejohnson.json",
    "token": "a3f9b1c2d4e5f6a7b8c9d0e1f2a3b4c5",
    "size": 4096,
    "modified": "2026-03-10T14:22:00.000Z",
    "created": "2026-01-15T09:00:00.000Z"
  }
]
```

Files are sorted newest-modified first. `.meta.json` companion files are hidden from this list.

---

### 21.10 Reading a File's Content

```http
GET /api/keyserver/keys/<filename>/content
Authorization: Bearer <admin-jwt-token>
```

Response:
```json
{ "content": "<raw file content as string>" }
```

---

### 21.11 Deleting a File

Single file:
```http
DELETE /api/keyserver/keys/<filename>
Authorization: Bearer <admin-jwt-token>
```

Batch:
```http
POST /api/keyserver/keys/batch-delete
Authorization: Bearer <admin-jwt-token>
Content-Type: application/json

{ "filenames": ["alice.json", "bob.yaml"] }
```

Deleting a file also removes its `.meta.json` companion and cleans up its token mapping.

---

### 21.12 API Authentication for Bots

All key server management endpoints require a valid **admin JWT**. The bot should:

1. **Log in once** to get a token:
```http
POST /api/auth/login
Content-Type: application/json

{ "username": "botadmin", "password": "..." }
```
Response includes `{ "token": "...", "refreshToken": "..." }`.

2. **Use the token** in every request:
```
Authorization: Bearer <token>
```

3. **Refresh when expired** (access token lifetime is typically 15 minutes):
```http
POST /api/auth/refresh
Content-Type: application/json

{ "refreshToken": "..." }
```

4. **Role requirement**: The bot's account must have role `ADMIN`. `SERVER_ADMIN` can read (`GET`) but cannot write, delete, or start/stop.

---

### 21.13 Error Reference

| HTTP Status | Meaning | Common cause |
|---|---|---|
| `400` | Bad request | Missing `filename`/`content`, invalid `filenames` array, unsupported file extension |
| `401` | Unauthorized | Missing or malformed `Authorization` header |
| `403` | Forbidden | Token valid but role is not ADMIN (write ops) or not ADMIN/SERVER_ADMIN (read ops) |
| `404` | Not found | Wrong path (e.g. `/files/` instead of `/keys/`), or the `keyserver.js` module failed to load at startup |
| `500` | Server error | Disk full, `configDir` not writable, filesystem error |

**If ALL `/api/keyserver/*` endpoints return 404:**
The entire route module failed to load at backend startup. Check the process log for:
```
Failed to load keyserver routes
```
Fix the startup error and restart the backend process.

---

## 22. JSON Generator — Exact Algorithm for Bots

This section documents exactly how the JSON Generator page (`/json-generator`) builds a sing-box JSON config, so a bot can replicate it perfectly and produce files that are byte-for-byte identical in structure to the UI output. This is required because **manually constructing the JSON in a different structure will not work correctly** with sing-box or the key server's format conversion.

---

### 22.1 What the Bot Got Wrong (Comparison)

Below is a direct comparison between a **bot-generated file** (maybarani — incorrect) and the **correct file** (yuyu — generated by the UI).

#### Mistake 1 — Did not use `urltest` groups

**Wrong (bot):** The selector directly lists node-1, node-2, node-3, node-4.
```json
{
  "type": "selector",
  "tag": "proxy",
  "outbounds": ["node-1", "node-2", "node-3", "node-4", "direct"],
  "default": "node-1"
}
```

**Correct (UI):** The selector always lists three `urltest` groups first, then the individual node tags, then `direct`. The default is always `♻️ Auto Switch`.
```json
{
  "type": "selector",
  "tag": "proxy",
  "outbounds": [
    "♻️ Auto Switch",
    "⚡ Fastest",
    "🛡️ Failover",
    "🇸🇬 VChannel-Premium (Unlimited) SG01",
    "🇸🇬 VChannel-Premium (Unlimited) SG02",
    "🇸🇬 VChannel-Premium (Unlimited) SG03",
    "🇸🇬 VChannel-Premium (Unlimited) SG04",
    "direct"
  ],
  "default": "♻️ Auto Switch"
}
```

#### Mistake 2 — Used raw IP addresses instead of domain names

**Wrong:** `"server": "159.89.207.135"` — raw IP from the proxy URI.

**Correct:** `"server": "pul01.vchannel.dpdns.org"` — domain name from the `domains` table.

The "Add Single Node" method replaces the server address with the domain entry's `domain` field when a server is selected from the dropdown. The bot must fetch the domains list and use the correct domain.

#### Mistake 3 — Used generic node names (`node-1`, `node-2`)

**Wrong:** `"tag": "node-1"`

**Correct:** `"tag": "🇸🇬 VChannel-Premium (Unlimited) SG01"`

The name is built from the domain entry (see Section 22.4).

#### Mistake 4 — Added obfs plugin

**Wrong:** Bot added `"plugin": "obfs-local", "plugin_opts": "obfs=tls;obfs-host=bing.com;..."` to shadowsocks outbounds.

**Correct:** The JSON generator does NOT support or output obfs plugins in sing-box format. The sing-box Shadowsocks outbound format has no `plugin` field. If the proxy URI contains obfs, the generator ignores it because `parseShadowsocks()` only extracts `cipher` and `password`. Do not add obfs manually.

#### Mistake 5 — Missing TUN `inet6_address` and `auto_redirect_output_mark`

**Wrong:**
```json
{
  "type": "tun",
  "inet4_address": "172.19.0.1/30",
  "auto_route": true,
  "strict_route": true,
  "stack": "mixed",
  "sniff": true
}
```

**Correct:**
```json
{
  "type": "tun",
  "tag": "tun-in",
  "inet4_address": "172.19.0.1/30",
  "inet6_address": "fdfe:dcba:9876::1/126",
  "auto_route": true,
  "strict_route": true,
  "stack": "mixed",
  "sniff": true,
  "auto_redirect_output_mark": 8872
}
```

#### Mistake 6 — Missing the three `urltest` outbound objects

**Correct:** Three `urltest` outbounds must always be present:
```json
{ "type": "urltest", "tag": "♻️ Auto Switch", "outbounds": [...nodeTags], "url": "http://www.gstatic.com/generate_204", "interval": "900s", "tolerance": 150 },
{ "type": "urltest", "tag": "⚡ Fastest",      "outbounds": [...nodeTags], "url": "http://www.gstatic.com/generate_204", "interval": "120s", "tolerance": 50  },
{ "type": "urltest", "tag": "🛡️ Failover",     "outbounds": [...nodeTags], "url": "http://www.gstatic.com/generate_204", "interval": "120s", "tolerance": 300 }
```

#### Mistake 7 — Simplified or missing routing rules

**Wrong:** Only 5 simple rules.

**Correct:** Full routing with `domain_suffix`, `domain_keyword`, and `ip_cidr` arrays for each app, plus `final_ipv6: true` and `auto_detect_interface: true`.

#### Mistake 8 — Missing `experimental` section

**Correct:** Always present at the end:
```json
"experimental": {
  "clash_api": { "external_controller": "127.0.0.1:9090" },
  "cache_file": { "enabled": true, "store_fakeip": false }
}
```

---

### 22.2 Step-by-Step Algorithm

The bot must follow this exact sequence to produce a correct sing-box JSON config:

```
INPUT:
  - groupName         (e.g. "VChannel-Premium")
  - unlim             (true/false — whether user has Unlimited plan)
  - proxyURIs[]       (array of ss:// vmess:// vless:// trojan:// hy2:// strings)
  - domainServerIds[] (parallel array — which domain entry ID to use for each proxy URI)
  - domainsMap        (result of GET /api/domains, keyed by id)

STEP 1: For each proxyURI[i]:
  a. Parse the proxy URI → extract cipher, password, port (and uuid/method etc.)
  b. Find domainEntry = domainsMap[domainServerIds[i]]
  c. Build internal node object (Clash-style)
  d. Set node.server    = domainEntry.domain
  e. Set node.name      = buildNodeName(groupName, unlim, domainEntry)

STEP 2: For each node, convert to sing-box outbound object via convertNodeToSingbox()

STEP 3: Assemble the full config object (see Section 22.5)

STEP 4: JSON.stringify(config, null, 2)

STEP 5: POST /api/keyserver/keys with the stringified config
```

---

### 22.3 Getting the Domain Server List

```http
GET /api/domains
Authorization: Bearer <admin-jwt-token>
```

Response (array):
```json
[
  { "id": 1, "domain": "pul01.vchannel.dpdns.org", "server": "SG01", "service": "Premium", "unlimited": true },
  { "id": 2, "domain": "pul02.vchannel.dpdns.org", "server": "SG02", "service": "Premium", "unlimited": true },
  { "id": 3, "domain": "pul03.vchannel.dpdns.org", "server": "SG03", "service": "Premium", "unlimited": true },
  { "id": 4, "domain": "pul04.vchannel.dpdns.org", "server": "SG04", "service": "Premium", "unlimited": true }
]
```

**Filtering by user plan:**
- If user is **Unlimited** → use only entries where `unlimited === true`
- If user is **Basic/Mini** → use only entries where `service === "Premium"` and `unlimited === false`

The bot must map each proxy URI to its corresponding domain entry. The correct pairing is usually positional (proxy URI 1 → domain entry 1, proxy URI 2 → domain entry 2, etc.) or by matching server number from the node name in the URI.

---

### 22.4 Node Name Formula

The node name (used as the `tag` in sing-box) must follow this exact format:

```
{FLAG_EMOJI} {groupName}{unlimLabel} {domainEntry.server}
```

| Part | Value |
|---|---|
| `FLAG_EMOJI` | Look up first 2 chars of `domainEntry.server` in the flag map |
| `groupName` | The group name setting (e.g. `"VChannel-Premium"`) |
| `unlimLabel` | `" (Unlimited)"` if `domainEntry.unlimited === true`, otherwise `""` |
| `domainEntry.server` | The `server` field from the domain entry (e.g. `"SG01"`) |

**Flag map:**
```json
{
  "SG": "🇸🇬",
  "HK": "🇭🇰",
  "US": "🇺🇸",
  "JP": "🇯🇵",
  "ID": "🇮🇩",
  "TH": "🇹🇭",
  "VN": "🇻🇳",
  "UK": "🇬🇧",
  "CN": "🇨🇳",
  "IN": "🇮🇳",
  "AU": "🇦🇺"
}
```

**Example:**
```
domain entry: { server: "SG01", unlimited: true }
groupName: "VChannel-Premium"

countryCode = "SG01".slice(0, 2).toUpperCase() = "SG"
flag        = "🇸🇬"
unlimLabel  = " (Unlimited)"
nodeName    = "🇸🇬 VChannel-Premium (Unlimited) SG01"
```

---

### 22.5 Parsing Proxy URIs

The JSON Generator's `parseShadowsocks` extracts only these fields:

```js
ss://BASE64(cipher:password)@server:port#name

→ {
  name: flag + decoded_name,    // bot should ignore this name — it will be replaced
  type: "ss",
  server: url.hostname,         // bot WILL replace this with domainEntry.domain
  port: parseInt(url.port),
  cipher: ...,                  // extracted from userinfo (e.g. "chacha20-ietf-poly1305")
  password: ...,                // extracted from userinfo
  udp: true
}
```

> ⚠️ **Plugin/obfs fields in the URI are silently dropped.** Do not re-add them. The sing-box Shadowsocks format does not use `plugin` or `plugin_opts`.

For VMess URIs (`vmess://BASE64_JSON`), the parsed fields map to:
```
{ name, type:"vmess", server, port, uuid, alterId, cipher, udp, network, tls, servername, ws-opts }
```

For VLESS, Trojan, Hysteria2 — similarly parsed from the URI parameters.

---

### 22.6 Converting a Node to sing-box Outbound Format

This is the exact conversion the generator uses. Apply per node:

#### Shadowsocks

```json
{
  "server": "<domainEntry.domain>",
  "server_port": <port>,
  "type": "shadowsocks",
  "tag": "<nodeName>",
  "method": "<cipher>",
  "password": "<password>"
}
```

No `plugin`, no `plugin_opts`. If the SS server uses TLS (rare), add:
```json
"tls": { "enabled": true, "insecure": true, "server_name": "<server>" }
```

#### VMess

```json
{
  "server": "<domain>",
  "server_port": <port>,
  "type": "vmess",
  "tag": "<nodeName>",
  "uuid": "<uuid>",
  "alter_id": 0,
  "security": "<cipher or 'auto'>"
}
```

Add `"tls": { "enabled": true, "insecure": true, "server_name": "<sni>" }` if TLS.
Add `"transport": { "type": "ws", "path": "<path>", "headers": { "Host": "<host>" } }` if WebSocket.

#### VLESS

```json
{
  "server": "<domain>",
  "server_port": <port>,
  "type": "vless",
  "tag": "<nodeName>",
  "uuid": "<uuid>",
  "tls": { "enabled": true, "insecure": true, "server_name": "<sni>" }
}
```

Add `"flow": "<flow>"` if present. Add `"transport"` if WebSocket or gRPC.

#### Trojan

```json
{
  "server": "<domain>",
  "server_port": <port>,
  "type": "trojan",
  "tag": "<nodeName>",
  "password": "<password>",
  "tls": { "enabled": true, "insecure": true, "server_name": "<sni>" }
}
```

#### Hysteria2

```json
{
  "server": "<domain>",
  "server_port": <port>,
  "type": "hysteria2",
  "tag": "<nodeName>",
  "password": "<password>",
  "tls": { "enabled": true, "insecure": true, "server_name": "<sni>" }
}
```

---

### 22.7 Full Config Structure

Assemble the config in this exact order. This matches what the generator produces (default settings, Anti-DPI off, Load Balance off):

```json
{
  "log": { "level": "info" },

  "dns": {
    "servers": [{ "tag": "default-dns", "address": "local" }],
    "final": "default-dns"
  },

  "inbounds": [
    {
      "type": "tun",
      "tag": "tun-in",
      "inet4_address": "172.19.0.1/30",
      "inet6_address": "fdfe:dcba:9876::1/126",
      "auto_route": true,
      "strict_route": true,
      "stack": "mixed",
      "sniff": true,
      "auto_redirect_output_mark": 8872
    },
    {
      "type": "mixed",
      "tag": "mixed-in",
      "listen": "::",
      "listen_port": 7890,
      "sniff": true
    }
  ],

  "outbounds": [
    {
      "type": "selector",
      "tag": "proxy",
      "outbounds": [
        "♻️ Auto Switch",
        "⚡ Fastest",
        "🛡️ Failover",
        "<nodeName1>",
        "<nodeName2>",
        "...",
        "direct"
      ],
      "default": "♻️ Auto Switch"
    },
    {
      "type": "urltest",
      "tag": "♻️ Auto Switch",
      "outbounds": ["<nodeName1>", "<nodeName2>", "..."],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "900s",
      "tolerance": 150
    },
    {
      "type": "urltest",
      "tag": "⚡ Fastest",
      "outbounds": ["<nodeName1>", "<nodeName2>", "..."],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "120s",
      "tolerance": 50
    },
    {
      "type": "urltest",
      "tag": "🛡️ Failover",
      "outbounds": ["<nodeName1>", "<nodeName2>", "..."],
      "url": "http://www.gstatic.com/generate_204",
      "interval": "120s",
      "tolerance": 300
    },
    { <node outbound 1> },
    { <node outbound 2> },
    { "..." },
    { "type": "direct", "tag": "direct" },
    { "type": "dns",    "tag": "dns-out" },
    { "type": "block",  "tag": "block" }
  ],

  "route": {
    "rules": [
      { "protocol": "dns", "outbound": "dns-out" },
      { "ip_is_private": true, "outbound": "direct" },
      { "domain_suffix": [ <proxy domain_suffix list> ], "outbound": "proxy" },
      { "domain_keyword": [ <proxy domain_keyword list> ], "outbound": "proxy" },
      { "ip_cidr": [ <proxy ip_cidr list> ], "outbound": "proxy" },
      { "domain_suffix": [ <direct domain_suffix list> ], "outbound": "direct" },
      { "domain_keyword": [ <direct domain_keyword list> ], "outbound": "direct" }
    ],
    "final": "proxy",
    "auto_detect_interface": true,
    "final_ipv6": true
  },

  "experimental": {
    "clash_api": { "external_controller": "127.0.0.1:9090" },
    "cache_file": { "enabled": true, "store_fakeip": false }
  }
}
```

---

### 22.8 Default App Routing Rules

The generator has 19 built-in apps with **default** routing assignments. These are split into `domain_suffix`, `domain_keyword`, and `ip_cidr` arrays per outbound target.

#### Default proxy apps (these go via `proxy` outbound by default)

| App | domain_suffix | domain_keyword | ip_cidr |
|---|---|---|---|
| Netflix | netflix.com, nflxvideo.net, nflximg.net, nflxext.com, nflxso.net | — | — |
| YouTube | youtube.com, googlevideo.com, ytimg.com, yt.be, youtu.be, youtube-nocookie.com, yt3.ggpht.com | — | — |
| Facebook | facebook.com, fbcdn.net, fb.com, fb.me, fbsbx.com, fbpigeon.com, fb.gg, facebook.net, facebookcorewwwi.onion, accountkit.com, freebasics.com | facebook, fbcdn | 31.13.24.0/21, 31.13.64.0/18, 45.64.40.0/22, 66.220.144.0/20, 69.63.176.0/20, 69.171.224.0/19, 74.119.76.0/22, 102.132.96.0/20, 103.4.96.0/22, 129.134.0.0/17, 157.240.0.0/17, 173.252.64.0/18, 179.60.192.0/22, 185.60.216.0/22, 185.89.218.0/23, 204.15.20.0/22, 2620:0:1c00::/40, 2a03:2880::/32 |
| Instagram | instagram.com, cdninstagram.com, ig.me, instagram.net | instagram | — |
| Messenger | messenger.com, m.me, msngr.com | messenger | 69.171.250.0/24, 31.13.86.0/24 |
| Threads | threads.net, threads.com | threads | — |
| Twitter | twitter.com, twimg.com, x.com, t.co, twittercdn.com, twitterstat.us, twttr.com | twitter | — |
| WhatsApp | whatsapp.com, whatsapp.net, wa.me | whatsapp | 18.194.0.0/15, 34.224.0.0/12, 50.19.0.0/16, 52.0.0.0/11 |
| Telegram | telegram.org, t.me, telegra.ph, telegram.me, telegram.dog, telesco.pe | — | 91.108.4.0/22, 91.108.8.0/21, 91.108.16.0/21, 91.108.56.0/22, 95.161.64.0/20, 149.154.160.0/20, 2001:67c:4e8::/48, 2001:b28:f23d::/48 |
| Signal | signal.org, whispersystems.org, signal.art | — | 13.248.212.0/24, 76.223.92.0/24 |
| Discord | discord.com, discordapp.com, discordapp.net, discord.gg, discord.media | discord | — |
| ChatGPT | openai.com, chatgpt.com, oaistatic.com, oaiusercontent.com | — | — |
| GitHub | github.com, githubusercontent.com, github.io, githubassets.com | — | — |

#### Default direct apps (these go via `direct` outbound by default)

| App | domain_suffix | domain_keyword |
|---|---|---|
| TikTok | tiktok.com, tiktokcdn.com, tiktokv.com, tiktokcdn-us.com, musical.ly | tiktok |
| Spotify | spotify.com, scdn.co, spotify.design, spotifycdn.com | — |
| Google | google.com, googleapis.com, gstatic.com | — |
| Microsoft | microsoft.com, live.com, msn.com | — |
| Apple | apple.com, icloud.com | — |
| Amazon | amazon.com, amazonaws.com | — |

**Building the routing rule arrays:**

Merge all proxy-routed apps together into a single rule per type:
```
proxy domain_suffix = [all domain_suffix values from proxy apps joined]
proxy domain_keyword = [all domain_keyword values from proxy apps joined]
proxy ip_cidr       = [all ip_cidr values from proxy apps joined, with /32 stripped from CIDR prefix for IPv6 entries]
```

Emit as separate `route.rules` entries:
```json
{ "domain_suffix":  [...all proxy domain_suffix...],  "outbound": "proxy" }
{ "domain_keyword": [...all proxy domain_keyword...],  "outbound": "proxy" }
{ "ip_cidr":        [...all proxy ip_cidr...],         "outbound": "proxy" }
{ "domain_suffix":  [...all direct domain_suffix...],  "outbound": "direct" }
{ "domain_keyword": [...all direct domain_keyword...], "outbound": "direct" }
```

Omit any rule where the array would be empty.

> **Note:** The `route.final` is `"proxy"` (not `"direct"`) — meaning all unmatched traffic goes through the VPN. This is the default.

---

### 22.9 Complete Bot Code Reference (Python pseudocode)

```python
import json
import requests

# ── Config ──
BACKEND = "http://your-cmp-server:3001"
HEADERS = {"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"}

GROUP_NAME = "VChannel-Premium"
FILE_PREFIX = "vchannel-config"

FLAG_MAP = {
    "SG": "🇸🇬", "HK": "🇭🇰", "US": "🇺🇸", "JP": "🇯🇵",
    "ID": "🇮🇩", "TH": "🇹🇭", "VN": "🇻🇳", "UK": "🇬🇧",
    "CN": "🇨🇳", "IN": "🇮🇳", "AU": "🇦🇺"
}

def build_node_name(group_name, domain_entry):
    code = domain_entry["server"][:2].upper()
    flag = FLAG_MAP.get(code, "")
    unlim_label = " (Unlimited)" if domain_entry["unlimited"] else ""
    return f"{flag} {group_name}{unlim_label} {domain_entry['server']}".strip()

def parse_ss_uri(uri):
    # ss://BASE64(cipher:password)@host:port#name
    from urllib.parse import urlparse, unquote
    import base64
    parsed = urlparse(uri)
    # username is the base64 part
    userinfo = base64.b64decode(parsed.username + "==").decode()
    cipher, password = userinfo.split(":", 1)
    return {
        "type": "ss",
        "server": parsed.hostname,  # will be replaced
        "port": parsed.port,
        "cipher": cipher,
        "password": password,
        "udp": True
    }

def node_to_singbox(node, node_name, domain):
    """Convert internal node dict to sing-box outbound object."""
    if node["type"] == "ss":
        return {
            "server": domain,
            "server_port": node["port"],
            "type": "shadowsocks",
            "tag": node_name,
            "method": node["cipher"],
            "password": node["password"]
        }
    # Add VMess/VLESS/Trojan/Hysteria2 branches similarly per Section 22.6

def build_config(group_name, unlim, node_outbounds):
    node_tags = [n["tag"] for n in node_outbounds]

    # Proxy routing rules — copy from Section 22.8
    proxy_domain_suffix = [
        "netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net",
        "youtube.com", "googlevideo.com", "ytimg.com", "yt.be", "youtu.be",
        "youtube-nocookie.com", "yt3.ggpht.com",
        "facebook.com", "fbcdn.net", "fb.com", "fb.me", "fbsbx.com",
        "fbpigeon.com", "fb.gg", "facebook.net", "facebookcorewwwi.onion",
        "accountkit.com", "freebasics.com",
        "instagram.com", "cdninstagram.com", "ig.me", "instagram.net",
        "messenger.com", "m.me", "msngr.com",
        "threads.net", "threads.com",
        "twitter.com", "twimg.com", "x.com", "t.co",
        "twittercdn.com", "twitterstat.us", "twttr.com",
        "whatsapp.com", "whatsapp.net", "wa.me",
        "telegram.org", "t.me", "telegra.ph", "telegram.me",
        "telegram.dog", "telesco.pe",
        "signal.org", "whispersystems.org", "signal.art",
        "discord.com", "discordapp.com", "discordapp.net",
        "discord.gg", "discord.media",
        "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
        "github.com", "githubusercontent.com", "github.io", "githubassets.com"
    ]
    proxy_domain_keyword = [
        "facebook", "fbcdn", "instagram", "messenger", "threads",
        "twitter", "whatsapp", "discord"
    ]
    proxy_ip_cidr = [
        "31.13.24.0/21", "31.13.64.0/18", "45.64.40.0/22", "66.220.144.0/20",
        "69.63.176.0/20", "69.171.224.0/19", "74.119.76.0/22", "102.132.96.0/20",
        "103.4.96.0/22", "129.134.0.0/17", "157.240.0.0/17", "173.252.64.0/18",
        "179.60.192.0/22", "185.60.216.0/22", "185.89.218.0/23", "204.15.20.0/22",
        "2620:0:1c00::/40", "2a03:2880::/32",
        "69.171.250.0/24", "31.13.86.0/24",
        "18.194.0.0/15", "34.224.0.0/12", "50.19.0.0/16", "52.0.0.0/11",
        "91.108.4.0/22", "91.108.8.0/21", "91.108.16.0/21", "91.108.56.0/22",
        "95.161.64.0/20", "149.154.160.0/20",
        "2001:67c:4e8::/48", "2001:b28:f23d::/48",
        "13.248.212.0/24", "76.223.92.0/24"
    ]
    direct_domain_suffix = [
        "tiktok.com", "tiktokcdn.com", "tiktokv.com", "tiktokcdn-us.com", "musical.ly",
        "spotify.com", "scdn.co", "spotify.design", "spotifycdn.com",
        "google.com", "googleapis.com", "gstatic.com",
        "microsoft.com", "live.com", "msn.com",
        "apple.com", "icloud.com",
        "amazon.com", "amazonaws.com"
    ]
    direct_domain_keyword = ["tiktok"]

    return {
        "log": {"level": "info"},
        "dns": {
            "servers": [{"tag": "default-dns", "address": "local"}],
            "final": "default-dns"
        },
        "inbounds": [
            {
                "type": "tun", "tag": "tun-in",
                "inet4_address": "172.19.0.1/30",
                "inet6_address": "fdfe:dcba:9876::1/126",
                "auto_route": True, "strict_route": True,
                "stack": "mixed", "sniff": True,
                "auto_redirect_output_mark": 8872
            },
            {
                "type": "mixed", "tag": "mixed-in",
                "listen": "::", "listen_port": 7890, "sniff": True
            }
        ],
        "outbounds": [
            {
                "type": "selector", "tag": "proxy",
                "outbounds": ["♻️ Auto Switch", "⚡ Fastest", "🛡️ Failover", *node_tags, "direct"],
                "default": "♻️ Auto Switch"
            },
            {
                "type": "urltest", "tag": "♻️ Auto Switch",
                "outbounds": node_tags,
                "url": "http://www.gstatic.com/generate_204",
                "interval": "900s", "tolerance": 150
            },
            {
                "type": "urltest", "tag": "⚡ Fastest",
                "outbounds": node_tags,
                "url": "http://www.gstatic.com/generate_204",
                "interval": "120s", "tolerance": 50
            },
            {
                "type": "urltest", "tag": "🛡️ Failover",
                "outbounds": node_tags,
                "url": "http://www.gstatic.com/generate_204",
                "interval": "120s", "tolerance": 300
            },
            *node_outbounds,
            {"type": "direct", "tag": "direct"},
            {"type": "dns",    "tag": "dns-out"},
            {"type": "block",  "tag": "block"}
        ],
        "route": {
            "rules": [
                {"protocol": "dns", "outbound": "dns-out"},
                {"ip_is_private": True, "outbound": "direct"},
                {"domain_suffix": proxy_domain_suffix, "outbound": "proxy"},
                {"domain_keyword": proxy_domain_keyword, "outbound": "proxy"},
                {"ip_cidr": proxy_ip_cidr, "outbound": "proxy"},
                {"domain_suffix": direct_domain_suffix, "outbound": "direct"},
                {"domain_keyword": direct_domain_keyword, "outbound": "direct"}
            ],
            "final": "proxy",
            "auto_detect_interface": True,
            "final_ipv6": True
        },
        "experimental": {
            "clash_api": {"external_controller": "127.0.0.1:9090"},
            "cache_file": {"enabled": True, "store_fakeip": False}
        }
    }


def generate_and_upload(user, proxy_uris, domain_entries):
    """
    user          — user object from GET /api/users/search
    proxy_uris    — list of ss:// (or vmess://, vless://, etc.) URIs
    domain_entries — list of domain objects from GET /api/domains (same order as proxy_uris)
    """
    group_name = GROUP_NAME
    unlim = user.get("service_type", "").lower() == "unlimited"

    # 1. Parse and build node outbounds
    node_outbounds = []
    for uri, domain_entry in zip(proxy_uris, domain_entries):
        node = parse_ss_uri(uri)   # or parse_vmess_uri() etc.
        node_name = build_node_name(group_name, domain_entry)
        sb_outbound = node_to_singbox(node, node_name, domain_entry["domain"])
        node_outbounds.append(sb_outbound)

    # 2. Build full config
    config = build_config(group_name, unlim, node_outbounds)
    content = json.dumps(config, indent=2, ensure_ascii=False)

    # 3. Build filename
    suffix = user["account_name"].lower().replace(" ", "").replace("_", "")
    filename = f"{FILE_PREFIX}-{suffix}.json"

    # 4. Build metadata
    data_limit_gb = user.get("data_limit_gb")
    expire_date = user.get("expire_date", "")
    metadata = {}
    if data_limit_gb:
        metadata["data_limit_gb"] = data_limit_gb
    if expire_date:
        metadata["expire_date"] = expire_date[:10]
    if unlim:
        metadata["unlimited"] = True

    # 5. Upload
    resp = requests.post(f"{BACKEND}/api/keyserver/keys",
        json={"filename": filename, "content": content, "metadata": metadata or None},
        headers=HEADERS)
    resp.raise_for_status()
    result = resp.json()

    # 6. Build 3 subscription URLs from JSON file token
    ks_config = requests.get(f"{BACKEND}/api/keyserver/config", headers=HEADERS).json()
    port = ks_config.get("port", 8088)
    secret_key = ks_config.get("secretKey", "")
    public_domain = ks_config.get("publicDomain", "")
    base_host = public_domain.rstrip("/") if public_domain else f"http://SERVER_IP:{port}"
    if not base_host.startswith("http"):
        base_host = f"http://{base_host}"
    token = result["token"]
    base_url  = f"{base_host}/sub/{token}?key={secret_key}"
    sub_url   = base_url
    raw_url   = f"{base_url}&format=raw"
    v2ray_url = f"{base_url}&format=v2ray"

    return {"filename": result["filename"], "token": token,
            "url": sub_url, "raw_url": raw_url, "v2ray_url": v2ray_url}
```

---

### 22.10 Quick Checklist for the Bot

Before uploading, verify the generated config has all of these:

- [ ] `log.level` is `"info"`
- [ ] `dns.servers[0]` is `{ "tag": "default-dns", "address": "local" }`
- [ ] TUN inbound has **both** `inet4_address` and `inet6_address`
- [ ] TUN inbound has `auto_redirect_output_mark: 8872`
- [ ] Selector outbounds list starts with `"♻️ Auto Switch"`, `"⚡ Fastest"`, `"🛡️ Failover"`
- [ ] All 3 `urltest` outbound objects are present (Auto Switch / Fastest / Failover)
- [ ] Node tags are in format `"{FLAG} {GroupName}{(Unlimited)} {ServerCode}"` — NOT `node-1`
- [ ] Node server is a **domain name** from the `domains` table — NOT a raw IP
- [ ] Shadowsocks outbounds have NO `plugin` or `plugin_opts` fields
- [ ] `route.final` is `"proxy"`
- [ ] `route.final_ipv6` is `true`
- [ ] `route.auto_detect_interface` is `true`
- [ ] `experimental.clash_api` section is present
- [ ] `experimental.cache_file` section is present
- [ ] Routing rules include `domain_suffix`, `domain_keyword`, and `ip_cidr` arrays (not empty)
