# Session Management and Permission Enhancement - Implementation Summary

## Overview
Implemented four major features to enhance the user management portal:

1. **SERVER_ADMIN Transfer Permissions** - Allow SERVER_ADMIN users to transfer users between servers they manage
2. **Online/Offline Status Display** - Real-time session status on user cards
3. **Session Timeout with Inactivity Tracking** - Proper session management that handles laptop hibernation/sleep
4. **Last Seen Tracking** - Display when users last ended their session

## Database Changes

### New Tables

#### `active_sessions` (Migration 019)
Tracks active user sessions with automatic timeout detection.

```sql
CREATE TABLE active_sessions (
    id BIGSERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_jti TEXT NOT NULL UNIQUE,
    last_activity TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW() NOT NULL
);
```

**Indexes:**
- `idx_active_sessions_admin_id` - Quick lookups by admin
- `idx_active_sessions_token_jti` - Quick lookups by token
- `idx_active_sessions_last_activity` - Finding inactive sessions
- `idx_active_sessions_admin_last_activity` - Composite for admin activity queries

#### `admins.last_seen` Column (Migration 020)
Added last_seen timestamp to track when users were last active.

```sql
ALTER TABLE admins ADD COLUMN last_seen TIMESTAMP WITHOUT TIME ZONE;
CREATE INDEX idx_admins_last_seen ON admins(last_seen DESC);
```

## Backend Changes

### 1. Transfer Permission Enhancement (`backend/routes/users.js`)

**Location:** Line 836 (POST /transfer endpoint)

**Change:** Replaced `isAdmin` middleware with custom authorization logic that:
- Allows ADMIN users to transfer anyone (global permission)
- Allows SERVER_ADMIN users to transfer users only between servers they manage
- Validates both source and target server permissions

**Authorization Logic:**
```javascript
// ADMIN can transfer anyone
if (req.user.role !== 'ADMIN') {
  // Check target server permission
  // Check all source server permissions
  // Reject if SERVER_ADMIN lacks permission for any involved server
}
```

### 2. Session Management (`backend/routes/auth.js`)

#### New Endpoints

**POST /api/auth/heartbeat**
- Updates `last_activity` timestamp for current session
- Creates session if not exists
- Called every 30 seconds from frontend
- Returns current timestamp

**GET /api/auth/sessions/active**
- Cleans up inactive sessions (>60 minutes since last_activity)
- Updates `last_seen` for timed-out sessions
- Returns all admins with their session status
- Response includes: `isOnline`, `lastActivity`, `sessionStarted`, `lastSeen`

#### Modified Endpoints

**POST /api/auth/login**
- Creates `active_sessions` record with token jti on successful login
- Sets initial `last_activity` to NOW()

**POST /api/auth/refresh**
- Creates new `active_sessions` record for refreshed token
- Updates `last_activity` to NOW()

**POST /api/auth/logout**
- Deletes `active_sessions` record
- Updates `last_seen` to NOW()
- Invalidates JWT token

### 3. Admin Listing Enhancement (`backend/routes/admin.js`)

**GET /api/admin/accounts**
- Modified to join with `active_sessions` table
- Returns `is_online`, `last_activity`, and `last_seen` for each admin
- Online status determined by presence of active session

## Frontend Changes

### 1. Global Heartbeat (`frontend/src/App.jsx`)

Added automatic heartbeat mechanism:
- Sends POST /api/auth/heartbeat every 30 seconds when logged in
- First heartbeat sent immediately on login
- Stops on logout
- Handles laptop sleep/hibernate correctly (next heartbeat after wake triggers timeout check if >60 min)

```javascript
useEffect(() => {
  if (!token) return;
  
  const sendHeartbeat = async () => {
    await axios.post('/api/auth/heartbeat', {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
  };
  
  sendHeartbeat(); // Initial
  const interval = setInterval(sendHeartbeat, 30000); // Every 30s
  
  return () => clearInterval(interval);
}, [token]);
```

### 2. Online/Offline Indicators (`frontend/src/pages/AdminPanelPage.jsx`)

**User Card Display:**
- Shows 🟢 green indicator for online users (with glow effect)
- Shows ⚫ gray indicator for offline users
- Tooltip shows "Online" or "Last seen: X minutes ago"
- "Last seen" pill only appears when user is offline

**Changes:**
- Replaced login_audit-based last seen with database-driven status
- Added status indicator next to display name
- Conditional rendering based on `is_online` field

### 3. Styling (`frontend/src/App.css`)

Added CSS for status indicators:
```css
.status-indicator {
  font-size: 0.7rem;
  display: inline-flex;
  align-items: center;
}

.status-indicator.online {
  filter: drop-shadow(0 0 3px rgba(0, 255, 0, 0.5));
}

.status-indicator.offline {
  opacity: 0.4;
}
```

## How It Works

### Session Flow

1. **Login:**
   - User logs in → JWT token with `jti` (unique ID) generated
   - `active_sessions` record created with `token_jti` and `last_activity = NOW()`

2. **Active Session:**
   - Frontend sends heartbeat every 30 seconds
   - Each heartbeat updates `last_activity = NOW()`
   - User appears as "online" (🟢)

3. **Laptop Sleep/Hibernate:**
   - Heartbeat stops while laptop is sleeping
   - `last_activity` timestamp remains at pre-sleep time
   - When laptop wakes up:
     - Next heartbeat attempts to update session
     - If `last_activity` is >60 minutes old, session is already cleaned up
     - User must re-authenticate

4. **Logout:**
   - Explicit logout deletes `active_sessions` record
   - `last_seen` updated to NOW()
   - User appears as "offline" (⚫) with last seen timestamp

5. **Timeout (Automatic):**
   - GET /api/auth/sessions/active cleans up sessions where `last_activity < NOW() - 60 minutes`
   - Deleted sessions get their `last_seen` updated to their final `last_activity` time
   - Happens automatically when admins view the accounts page or call sessions API

### Transfer Permission Flow

1. **ADMIN User:**
   - Full transfer rights
   - No permission checks
   - Can transfer users between any servers

2. **SERVER_ADMIN User:**
   - Attempts transfer
   - Backend checks `server_admin_permissions` table
   - Must have permission for target server
   - Must have permission for all source servers (where users are being transferred from)
   - If missing any permission → 403 Forbidden with specific error

## Configuration

### Session Timeout
Currently hardcoded to **60 minutes** in:
- `backend/routes/auth.js` line ~330: `const timeoutMinutes = 60;`

To change timeout, modify this value and ensure frontend heartbeat interval (30s) is less than timeout.

### Heartbeat Interval
Currently set to **30 seconds** in:
- `frontend/src/App.jsx` line ~365: `setInterval(sendHeartbeat, 30000);`

## Testing Checklist

- [x] Migrations run successfully (019, 020)
- [x] Backend compiles without errors
- [x] Frontend builds successfully
- [ ] Login creates active_sessions record
- [ ] Heartbeat updates last_activity
- [ ] User shows as online after login
- [ ] User shows as offline after logout with correct last_seen
- [ ] User shows as offline after 60+ minutes of inactivity
- [ ] Laptop sleep >60 minutes causes session timeout
- [ ] SERVER_ADMIN can transfer users between their servers
- [ ] SERVER_ADMIN cannot transfer users from servers they don't manage
- [ ] ADMIN can still transfer any users

## Future Enhancements

1. **Configurable Timeout:** Move session timeout to app_settings
2. **Multiple Sessions:** Track multiple concurrent sessions per user
3. **Session History:** Archive ended sessions for audit purposes
4. **Force Logout:** Admin ability to terminate other users' sessions
5. **Session Details:** Show IP, user agent, location in session list
6. **Activity Tracking:** Track page views and actions in session

## Files Modified

### Backend
- `backend/routes/users.js` - Transfer permission logic
- `backend/routes/auth.js` - Session management endpoints
- `backend/routes/admin.js` - Admin listing with session status
- `backend/migrations/019-table-active_sessions.sql` - New table
- `backend/migrations/020-admins-last_seen.sql` - New column

### Frontend
- `frontend/src/App.jsx` - Global heartbeat mechanism
- `frontend/src/pages/AdminPanelPage.jsx` - Online/offline indicators
- `frontend/src/App.css` - Status indicator styling

## Migration Commands

```bash
cd backend
node run_migrations.js
```

## Restart Required

After deploying these changes:
1. Run database migrations
2. Restart backend server
3. Rebuild and deploy frontend
4. All existing sessions will be invalidated (users must re-login)
