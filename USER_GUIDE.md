# VChannel — Customer Management Portal: User Guide

> **Version:** 1.x | **Last updated:** March 2026

---

## Table of Contents

1. [Overview](#overview)
2. [User Roles & Permissions](#user-roles--permissions)
3. [Logging In](#logging-in)
4. [Navigation & Layout](#navigation--layout)
5. [Dashboard](#dashboard)
6. [Server List](#server-list)
7. [Server Detail (User Management)](#server-detail-user-management)
8. [Key Management (Per Server)](#key-management-per-server)
9. [Key Manager (Global)](#key-manager-global)
10. [Domain Manager](#domain-manager)
11. [Search](#search)
12. [Financial Reports](#financial-reports)
13. [YAML Generator](#yaml-generator)
14. [JSON Generator](#json-generator)
15. [Admin Panel](#admin-panel)
16. [Settings](#settings)
17. [Account Management](#account-management)
18. [Themes & Appearance](#themes--appearance)
19. [Session Management & Auto-Logout](#session-management--auto-logout)

---

## Overview

The **VChannel Customer Management Portal** is a web-based administration tool for managing VPN/proxy servers, their users, subscription keys, access configurations, and financial reports. It provides a centralized interface for administrators and server managers to:

- Monitor all servers and their users from a single dashboard
- Add, edit, disable, or remove users and manage their subscription expiry
- Generate and distribute client configuration files (YAML and JSON)
- Manage domain assignments and access keys
- Track revenue and generate financial snapshots
- Administer staff accounts with role-based access control

---

## User Roles & Permissions

The portal has three account roles. Access to pages and actions depends on the role assigned to your account.

| Feature / Page | ADMIN | SERVER_ADMIN | VIEWER |
|---|:---:|:---:|:---:|
| Dashboard | ✅ | ✅ | ✅ |
| Server List (view) | ✅ | ✅ | ✅ |
| Server List (add / edit / delete server) | ✅ | ➖ | ❌ |
| Server Detail (view users) | ✅ | ✅* | ✅ |
| Server Detail (add / edit / delete users) | ✅ | ✅* | ❌ |
| Key Management (per server) | ✅ | ✅* | ❌ |
| Key Manager (global) | ✅ | ✅ | ❌ |
| Domain Manager | ✅ | ❌ | ❌ |
| Search | ✅ | ✅ | ✅ |
| Financial Reports | ✅ | ✅ | ❌ |
| YAML Generator | ✅ | ✅ | ✅ |
| JSON Generator | ✅ | ✅ | ✅ |
| Admin Panel | ✅ | ❌ | ❌ |
| Settings | ✅ | ❌ | ❌ |

> `*` SERVER_ADMIN can only manage servers they have been explicitly assigned to.

---

## Logging In

1. Navigate to the portal URL in your browser.
2. On the **Login** page, enter your **Username** and **Password**.
3. Click **Login**.

If your credentials are correct, you will be redirected to the Dashboard. If not, an error message is displayed.

> **Tip:** You can switch between Dark, Light, and System themes directly on the Login page using the theme toggle icons in the top-right corner.

---

## Navigation & Layout

After logging in, the main layout appears with:

- **Top navigation bar** — contains the application logo/title, navigation links (Dashboard, Financial, Server List, Search, Key Manager), and a **user profile menu** (top-right).
- **Main content area** — the page-specific content.
- **Back to Top button** — appears in the bottom-right corner when you scroll down.
- **Toast notifications** — short pop-up messages confirming actions (add, save, delete, etc.).

### User Profile Menu (Top-Right)

Click your username or avatar to open the profile dropdown:

| Option | Description |
|---|---|
| **Edit Profile** | Opens the account editor to update your display name, avatar, or assigned servers |
| **Change Password** | Opens the change-password form |
| **Theme** | Toggle between Dark / Light / System modes |
| **Telegram** | View your Telegram notification status |
| **About** | Shows app version, Git SHA, build time, and backend URL |
| **Logout** | Signs you out of the portal |

---

## Dashboard

**Route:** `/` (default after login)

The Dashboard gives a real-time summary of all servers and users.

### Summary Cards

The top of the page shows four summary cards:

| Card | Description |
|---|---|
| **Total Servers** | Number of servers registered in the system |
| **Total Users** | Total user count across all servers |
| **Active Users** | Users whose subscription has not expired |
| **Expiring Soon** | Users expiring within 24 hours |

Click on the **Active**, **Expire Soon**, or **Expired** cards to open a modal listing all users in that status category.

### Tier Breakdown

Below the summary cards, a **tier breakdown** chart shows the distribution of users across service tiers:
- **Mini** — entry-level tier
- **Basic** — standard tier
- **Unlimited** — unlimited-data tier

Click on any tier label to open a modal listing all users in that tier.

### Server Cards

Each registered server is displayed as a card showing:
- Server name and IP / domain
- Active / Expired / Soon user counts
- A link to the **Server Detail** page

### Auto-Refresh

The dashboard auto-refreshes data at a configurable interval (default: 30 seconds). You can change this interval using the refresh selector at the top of the page. A spinning indicator appears while a refresh is in progress.

---

## Server List

**Route:** `/server-list`

Displays all servers in a paginated list. Each row shows the server name, owner, service type, IP address, domain, and action buttons.

### Actions (ADMIN only)

| Action | How |
|---|---|
| **Add New Server** | Click **Add New Server** button at the top. Fill in server name, owner, service type, IP address, domain, and optional API key. |
| **Edit Server** | Click the settings (gear) icon on a server row. Update fields in the modal and save. |
| **Delete Server** | Click the trash icon on a server row. Confirm deletion in the modal. |
| **Copy IP/API Key** | Click the copy icons in the row. |
| **Reorder Servers** | Click **Reorder** to enter reorder mode. Drag handles appear — drag rows to rearrange the display order, then click **Save Order**. |

### User Transfer

Click **Transfer Users** to open the **User Transfer Modal**. This allows you to:
1. Select a **source server** and a **target server**.
2. Filter and search users on the source server.
3. Select specific users to transfer.
4. Click **Transfer** to move the selected users.

### Domain Manager Link

Admins see a **Domain Manager** button in the header, linking directly to the Domain Manager page.

---

## Server Detail (User Management)

**Route:** `/servers/:id`

This page shows full details for a single server and all its users.

### Server Info

At the top: server name, IP/domain, service type, owner, and total user count.

### User Table

Each row in the table shows:

| Column | Description |
|---|---|
| **Account Name** | The user's account/username |
| **Service Type** | Mini, Basic, or Unlimited |
| **Contact** | Optional contact information |
| **Expire Date** | Subscription expiry date |
| **Time Left** | Days and hours remaining until expiry |
| **Status** | Active / Expire Soon / Expired / Disabled |
| **Enabled** | Toggle to enable or disable the user's access |
| **Actions** | Edit, Quick Renew, Delete |

### Filtering & Search

- **Search bar** — filter users by account name or contact.
- **Status filter** — All / Active / Expire Soon / Expired.
- **Service filter** — All / Mini / Basic / Unlimited.

### Adding a User

Click **Add User** to expand the add-user form. Fill in:
- **Account Name** (required)
- **Service Type** (Mini / Basic / Unlimited)
- **Contact** (optional)
- **Expire Date**
- **Total Devices** (auto-filled based on service type)
- **Data Limit (GB)** (hidden for Unlimited)
- **Remark** (optional notes)

Click **Add** to save.

### Editing a User

Click the **Edit** (gear) icon on a user row to open the Edit User Modal. Modify fields and click **Save**.

### Quick Renew

Click the **clock** icon on a user row to quickly extend the expiry by a preset duration (e.g., 1 month from today or from the current expiry date).

### Enabling / Disabling a User

Click the **toggle** icon in the Enabled column to instantly enable or disable a user's access without deleting them.

### Deleting a User

Click the **trash** icon and confirm in the modal.

### Import / Export

| Action | Description |
|---|---|
| **Export** | Downloads all users for this server as a CSV file. |
| **Import** | Upload a CSV file. A mode selection modal appears: choose **Merge** (add/update users without deleting existing ones) or **Overwrite** (delete all existing users first, then import). |

---

## Key Management (Per Server)

**Route:** `/servers/:id/keys`

Manage access keys associated with a specific server.

### Key Table

Each key row shows:
- Key description
- The key value (masked by default)
- Associated user
- Action buttons (copy, edit, delete)

### Adding a Key

Click **Add Key** to open the key form:
- **Description** — a label for the key
- **Key value** — paste or generate a key
- **Prefix** — optional URL prefix (toggle to enable and customize)
- **Suffix type** — choose between Username or Custom suffix
- **Assign to user** — link the key to a specific user account

### Sorting

Click any column header to sort the key list by that column. Click again to reverse the sort direction.

### Deleting Keys

Click the trash icon on a key row and confirm in the modal.

---

## Key Manager (Global)

**Route:** `/key-manager`

**Access:** ADMIN and SERVER_ADMIN

The Key Manager manages the **Key Server** — a built-in HTTP server that serves configuration files to clients — and the configuration files stored on disk.

### Key Server Configuration (ADMIN only)

Click the **Config** button to reveal the key server settings:

| Field | Description |
|---|---|
| **Port** | The port the key server listens on (default: 8088) |
| **Secret Key** | Authentication token for the key server |
| **Config Directory** | Filesystem path where config files are stored |
| **Public Domain** | The public-facing URL/domain clients use to fetch configs |
| **Auto Start** | Automatically start the key server when the portal starts |

Click **Save Config** to persist changes.

### Key Server Status

The status badge shows whether the key server is **Running** or **Stopped**.

| Button | Action |
|---|---|
| **Start** | Starts the key server |
| **Stop** | Stops the key server |
| **Restart** | Restarts the key server |

### Config File List

All config files in the configured directory are listed with:
- Filename
- File type (YAML / JSON / TXT)
- Last modified date

### File Actions

| Action | Description |
|---|---|
| **Preview** | View file contents in a modal |
| **Copy URL** | Copy the public URL for this config file (for sharing with clients) |
| **Download** | Download the file to your computer |
| **Delete** | Delete the file (with confirmation) |
| **Bulk Delete** | Select multiple files with checkboxes, then click Delete Selected |

### Search & Filter

- **Search bar** — filter files by filename
- **Type filter** — All / YAML / JSON / TXT

### Sorting & Pagination

Click **Filename** or **Modified** column headers to sort. Use the pagination controls to navigate between pages. Change **Items per page** as needed.

### Import Config File

Click **Import** to upload a local config file directly into the server's config directory.

### Backup & Restore

| Action | Description |
|---|---|
| **Backup** | Downloads all config files as a single `.zip` archive |
| **Restore** | Upload a previously downloaded backup `.zip` to restore config files |

---

## Domain Manager

**Route:** `/domain-manager`  
**Access:** ADMIN only

Manage the domain pool assigned to different service tiers and server regions.

### Domain Table

Each row shows:
- **Domain** — the domain name
- **Server Region** — e.g., SG, HK, US, JP
- **Service** — Mini / Basic / Unlimited
- **Unlimited** toggle

### Adding a Domain

Fill in the form at the top:
1. **Domain** — enter the domain name
2. **Server Region** — select from the dropdown (SG, HK, US, JP, ID, TH, VN, UK, CN, IN, AU)
3. **Service** — select the service tier
4. **Unlimited** — check if unlimited data applies to this domain

Click **Add Domain**.

### Editing a Domain

Click the **Edit** icon on a row. Inline editing becomes active — update the fields and click **Save**.

### Deleting Domains

- Click the **trash** icon on a row to delete a single domain.
- Check multiple domains using the checkboxes, then click **Delete Selected** for bulk deletion.

### Sorting

Click the **Domain**, **Server**, or **Service** column headers to sort.

---

## Search

**Route:** `/search`

**Access:** All logged-in users

Use the global search to find users across all servers.

### Searching

Type a name, username, contact, or other keyword in the search bar and press **Enter** or click the search button. Results appear below.

### Search Results

Each result shows:
- Account name and service type
- Server the user belongs to (with a link to the Server Detail page)
- Expiry date and status
- Contact information

### Quick Renew from Search

Click the **Quick Renew** (clock) icon on a result row to extend the user's subscription directly from the search page.

### Navigating to User

Click the **external link** icon to jump directly to the server where that user is registered.

---

## Financial Reports

**Route:** `/financial`  
**Access:** ADMIN and SERVER_ADMIN

View revenue analytics and generate monthly financial snapshots.

### Date Range Filter

Select the reporting period:
- **Last 6 months** (default)
- **Last 12 months**
- **Custom range** — pick a start and end date using the date pickers

### User Filter (ADMIN only)

Admins can filter the report by a specific user account using the user selector dropdown.

### Revenue Chart

A **bar chart** displays monthly revenue for the selected date range. Hover over bars to see exact values.

### Monthly Breakdown Table

Below the chart, a table shows each month's revenue in detail. Click a month row to see more detail for that period.

### Generating a Snapshot

Click **Generate Snapshot** for a specific month to save a revenue record for that month. This is useful for archiving monthly totals before data changes.

---

## YAML Generator

**Route:** `/yaml-generator`  
**Access:** All logged-in users

Generate **Clash-compatible YAML** configuration files that can be shared with users as their proxy client config.

### Settings

Click the **Settings** (gear icon) to expand:

| Setting | Description |
|---|---|
| **Group Name** | The proxy group name shown in the client app |
| **Unlimited** | Toggle unlimited data for this config |
| **Load Balance** | Enable load balancing across multiple nodes |
| **Static Balance** | Use a fixed balancing strategy |
| **Expire Date** | Set a subscription expiry date in the config |
| **Update Interval** | How often (hours) the client checks for config updates |
| **Check Interval** | Connection health check interval (seconds) |
| **Auto-Switch Interval** | How often (seconds) the client auto-switches nodes |
| **Global Default** | Default routing mode (Proxy / Direct / Reject) |

### Anti-DPI / Censorship Evasion

Expand the **Anti-DPI** section to configure:
- **TCP Concurrent**
- **Client Fingerprint** (random, chrome, firefox, safari, etc.)
- **DoH (DNS over HTTPS)** — enable and set the DoH server URL
- **Fake DNS**
- **TLS Fragment** — with adjustable length and interval ranges

### Servers

- **Select from domain servers** — pick a pre-registered domain/server
- **Bulk input** — paste multiple server entries at once
- **Single input** — add one server at a time
- **Active nodes list** — shows all added nodes; remove any with the trash icon

### User Search

Search for a registered user to auto-fill their account details into the config (e.g., username/account name as suffix).

### Filename

Set a **file prefix** and optional **file suffix** that will be used as the downloaded file's name.

### Generate & Download

Click **Generate YAML** to preview the config. Click **Download** to save it as a `.yaml` file. You can also **Copy** the content to clipboard.

---

## JSON Generator

**Route:** `/json-generator`  
**Access:** All logged-in users

Generate **sing-box** (or similar) compatible **JSON** configuration files.

The JSON Generator has the same core features as the YAML Generator, with these additions:

| Setting | Description |
|---|---|
| **Also Save as TXT** | When saving, also produce a `.txt` copy |
| **SS Prefix** | Enable Shadowsocks prefix obfuscation with a custom prefix value |

All other settings (group name, unlimited, load balance, expire date, intervals, Anti-DPI, server nodes, user search, filename, generate/download) are the same as the YAML Generator.

---

## Admin Panel

**Route:** `/admin`  
**Access:** ADMIN only

Manage staff accounts (Admins, Server Admins, Viewers) and view the audit log.

### Account List

Each account row shows:
- Display name and username
- Role badge (ADMIN / SERVER_ADMIN / VIEWER)
- Assigned server permissions
- Action buttons (Edit, Delete, View Logs)

### Search Accounts

Use the search bar at the top to filter accounts by name or username.

### Adding an Account

Click **Add Account** to open the account editor form:

| Field | Description |
|---|---|
| **Display Name** | Friendly name shown in the UI |
| **Username** | Login username |
| **Password** | Initial password |
| **Role** | ADMIN / SERVER_ADMIN / VIEWER |
| **Assigned Servers** | Select which servers this account can manage (SERVER_ADMIN / VIEWER) |
| **Avatar** | Upload a profile picture |

Click **Save** to create the account.

### Editing an Account

Click the **Edit** icon on any account row. The same editor form opens pre-filled with the current details. Change any fields and click **Save**.

When editing your own account, you also see the **Reset Password** section to change your password.

### Deleting an Account

Click the **Delete** icon and confirm. The currently logged-in account cannot delete itself.

### Viewing Audit Logs

Click the **History** icon on an account row to open the audit log modal. It shows a timestamped history of login activity and actions performed by that account.

### Export / Import Accounts

| Action | Description |
|---|---|
| **Export** | Download all account data as a JSON file for backup |
| **Import** | Upload a previously exported JSON file to restore accounts |

### Database View Status (MatView)

The admin panel shows the **MatView Status** component — a database materialized view indicator. It shows when the user status view was last refreshed and allows a manual refresh to ensure data is up to date.

---

## Settings

**Route:** `/settings`  
**Access:** ADMIN only

The Settings page has multiple tabs for configuring different aspects of the application.

### Database Tab

Configure the **PostgreSQL database** connection:

| Field | Description |
|---|---|
| **Host** | Database server hostname or IP |
| **Port** | Database port (default: 5432) |
| **User** | Database username |
| **Password** | Database password |
| **Database** | Database name |
| **SSL** | Enable SSL for the database connection |

Click **Save** and then **Test Connection** to verify the settings work.

### General Tab

Configure application-wide appearance and behavior:

| Field | Description |
|---|---|
| **Application Title** | The name displayed in the browser tab and navigation bar |
| **Theme** | Default theme: Dark / Light / System |
| **Logo** | Upload a logo image (1x and 2x for retina displays) |
| **Favicon** | Upload a browser tab icon |
| **Apple Touch Icon** | Upload a home screen icon for iOS devices |
| **Auto-Logout Minutes** | Minutes of inactivity before the session expires (0 = disabled) |
| **Show Tooltips** | Enable or disable hover tooltips throughout the UI |
| **Price — Mini** | Subscription price for the Mini tier |
| **Price — Basic** | Subscription price for the Basic tier |
| **Price — Unlimited** | Subscription price for the Unlimited tier |
| **Currency** | Currency code used for pricing (e.g., USD, SGD) |
| **Timezone** | Timezone for displaying dates and times |

Click **Save General** to apply. Logo and favicon changes take effect immediately.

### Control Tab

**Remote control** configuration for integrations and external management:

- Configure the **control endpoint** and **API tokens** for server-to-server communication.
- View the current control panel connection status.

---

## Account Management

### Changing Your Password

1. Click your username in the top-right corner.
2. Select **Change Password**.
3. Enter your **current password**, then your **new password** (minimum 6 characters), and **confirm** the new password.
4. Click **Change Password**.

A confirmation message indicates success or failure.

### Editing Your Profile

1. Click your username in the top-right corner.
2. Select **Edit Profile**.
3. Update your **Display Name**, **Avatar**, or other details in the form.
4. Click **Save**.

---

## Themes & Appearance

The portal supports three theme modes:

| Mode | Description |
|---|---|
| **Dark** | Dark background (default for most displays) |
| **Light** | Light/white background |
| **System** | Automatically follows your operating system's dark/light preference |

To change the theme:
- From the **Login** page: use the Moon / Sun / Monitor icons in the top-right corner.
- After login: click your username → **Theme** → select the desired mode.

Your theme preference is saved in the browser and persists across sessions.

---

## Session Management & Auto-Logout

To protect your account, the portal can automatically log you out after a period of inactivity.

- The inactivity timeout is configured by an administrator in **Settings → General → Auto-Logout Minutes**.
- When your session is about to expire, a **"Session expiring"** notification slides in from the right showing a countdown.
  - Click **Extend** to reset the idle timer and stay logged in.
  - Click **Dismiss** to close the notification (the countdown continues).
- If the timer reaches zero without interaction, you are automatically logged out and redirected to the Login page.
- Setting Auto-Logout to **0** disables the idle timeout.

---

## Tips & Shortcuts

| Tip | Detail |
|---|---|
| **Copy IP or API Key** | Click the copy icon next to IP/API fields on the Server List page |
| **Sort any table** | Click a column header to sort; click again to reverse |
| **Paginate** | Use Prev / Next buttons or page number inputs throughout the app |
| **Keyboard close modal** | Press **Escape** to close any open modal dialog |
| **Export before deleting** | Always export a backup before performing bulk deletes or overwrites |
| **Reorder servers** | Use the drag-and-drop reorder mode on the Server List to control display order on the dashboard |
| **About box** | Shows the current app version, Git SHA, and build time — useful when reporting issues |

---

*For installation instructions, VPS deployment, or API reference, see the other documentation files in the repository: [README.md](README.md), [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md), [WINDOWS_INSTALL.md](WINDOWS_INSTALL.md).*
