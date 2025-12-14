# Testing Guide - Session Management Features

## Prerequisites
- Database migrations 019 and 020 have been applied
- Backend server is running on port 3001
- Frontend is built and being served

## Test Scenarios

### 1. Test SERVER_ADMIN Transfer Permissions

#### Setup
1. Login as ADMIN user
2. Create a SERVER_ADMIN user (e.g., "server_admin_test")
3. Assign the SERVER_ADMIN to manage specific servers (e.g., Server 1 and Server 2)
4. Create some test users on Server 1, Server 2, and Server 3

#### Test Cases

**A. Transfer within allowed servers (should succeed)**
1. Logout from ADMIN account
2. Login as server_admin_test
3. Navigate to Users page
4. Select users from Server 1
5. Transfer them to Server 2
6. Expected: Transfer succeeds ✅

**B. Transfer from unauthorized server (should fail)**
1. Still logged in as server_admin_test
2. Try to select users from Server 3 (not assigned to server_admin_test)
3. Attempt to transfer to Server 1
4. Expected: 403 Forbidden error with message about lacking source server permission ❌

**C. Transfer to unauthorized server (should fail)**
1. Still logged in as server_admin_test
2. Select users from Server 1
3. Try to transfer to Server 3 (not assigned to server_admin_test)
4. Expected: 403 Forbidden error with message about lacking target server permission ❌

**D. ADMIN can transfer anywhere (should succeed)**
1. Logout from server_admin_test
2. Login as ADMIN
3. Transfer users from any server to any other server
4. Expected: All transfers succeed ✅

### 2. Test Online/Offline Status Display

#### Setup
1. Have at least 2 user accounts (e.g., admin and editor1)
2. Open Admin Panel in two different browsers (or incognito mode)

#### Test Cases

**A. Initial login shows online**
1. Browser 1: Login as admin
2. Browser 2: Login as editor1
3. In Browser 1 (admin view), go to Admin Panel
4. Expected: Both admin and editor1 show 🟢 green online indicator ✅

**B. Heartbeat keeps session alive**
1. Leave both browsers open for 2 minutes
2. Refresh Admin Panel in Browser 1
3. Expected: Both users still show 🟢 online ✅

**C. Logout shows offline with last_seen**
1. Browser 2: Logout as editor1
2. Browser 1: Refresh Admin Panel
3. Expected: 
   - admin still shows 🟢 online
   - editor1 shows ⚫ offline with "Last seen: X seconds ago" ✅

**D. Tooltip shows correct information**
1. Hover over online indicator (🟢)
2. Expected: Tooltip shows "Online" ✅
3. Hover over offline indicator (⚫)
4. Expected: Tooltip shows "Last seen: X minutes ago" ✅

### 3. Test Session Timeout (Inactivity)

This is the most important test for the hibernate/sleep scenario.

#### Setup
1. Login as any user
2. Open browser developer tools → Network tab

#### Test Cases

**A. Heartbeat is working**
1. Watch Network tab after login
2. Expected: POST /api/auth/heartbeat every 30 seconds ✅

**B. Session stays active with heartbeat**
1. Keep browser open and active for 5 minutes
2. Navigate around the app
3. Check Admin Panel
4. Expected: User still shows as online 🟢 ✅

**C. Session timeout after inactivity**

This test requires modifying the timeout temporarily for faster testing:

**Option 1: Test with 2-minute timeout (recommended for testing)**
1. Edit `backend/routes/auth.js` line ~330
2. Change `const timeoutMinutes = 60;` to `const timeoutMinutes = 2;`
3. Restart backend server
4. Login to the application
5. **Stop the heartbeat** by either:
   - Closing the browser tab (without logging out), OR
   - Disabling JavaScript in browser
6. Wait 2+ minutes
7. Login as different admin user
8. View Admin Panel
9. Expected: First user shows ⚫ offline with last_seen timestamp ✅
10. Restore timeout to 60 minutes and restart backend

**Option 2: Test with full 60-minute timeout (real-world test)**
1. Login to the application
2. Close laptop lid (hibernate/sleep) for 65+ minutes
3. Wake laptop
4. Try to use the application
5. Expected: Session has expired, user needs to re-login ✅
6. After re-login, check Admin Panel
7. Expected: User shows as online 🟢 with new session ✅

**D. Laptop sleep/wake < 60 minutes**
1. Login to the application
2. Close laptop lid for 30 minutes
3. Wake laptop
4. Application should still work (heartbeat resumes)
5. Expected: User stays online 🟢 ✅

### 4. Test Last Seen Tracking

#### Test Cases

**A. Last seen updates on logout**
1. Login as user1
2. Note the current time
3. Wait 1 minute
4. Logout
5. Login as different admin
6. View Admin Panel → check user1
7. Expected: Last seen shows ~1 minute ago ✅

**B. Last seen updates on timeout**
1. Login as user2
2. Force session timeout (see 3C above)
3. Login as admin
4. View Admin Panel → check user2
5. Expected: Last seen shows the time of last activity before timeout ✅

**C. Last seen persists**
1. After user1 is offline (from test 4A)
2. Restart backend server
3. Login as admin
4. View Admin Panel
5. Expected: user1's last_seen still shows correct timestamp ✅

## Automated Testing Commands

### Backend API Tests

Test heartbeat endpoint:
```bash
# Login first
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your_password"}' \
  -c cookies.txt

# Get token from response, then test heartbeat
curl -X POST http://localhost:3001/api/auth/heartbeat \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Test sessions endpoint:
```bash
curl -X GET http://localhost:3001/api/auth/sessions/active \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Test accounts endpoint (includes session status):
```bash
curl -X GET http://localhost:3001/api/admin/accounts \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Database Verification

Check active sessions:
```sql
SELECT 
  s.id,
  a.username,
  s.last_activity,
  NOW() - s.last_activity as idle_time
FROM active_sessions s
JOIN admins a ON s.admin_id = a.id;
```

Check last_seen values:
```sql
SELECT 
  id,
  username,
  last_seen,
  NOW() - last_seen as time_since_last_seen
FROM admins
WHERE last_seen IS NOT NULL
ORDER BY last_seen DESC;
```

Find inactive sessions (>60 min):
```sql
SELECT 
  s.id,
  a.username,
  s.last_activity,
  NOW() - s.last_activity as idle_time
FROM active_sessions s
JOIN admins a ON s.admin_id = a.id
WHERE s.last_activity < NOW() - INTERVAL '60 minutes';
```

## Expected Database State

### After Login
- New row in `active_sessions` with current timestamp in `last_activity`
- New row in `login_audit` table

### During Active Session
- `active_sessions.last_activity` updates every 30 seconds (via heartbeat)

### After Logout
- Row removed from `active_sessions`
- `admins.last_seen` updated to logout time

### After Timeout
- Row removed from `active_sessions` (when sessions/active is called)
- `admins.last_seen` updated to last_activity time

## Troubleshooting

### User always shows offline
- Check if heartbeat is running (Network tab in browser dev tools)
- Verify backend server is running
- Check for CORS errors in console
- Verify token is valid (not expired)

### User shows online after logout
- Check if logout endpoint is properly deleting active_sessions
- Verify database connection is working
- Check backend logs for errors

### Session doesn't timeout
- Verify timeout is set correctly in backend/routes/auth.js
- Check if cleanup query is running when /sessions/active is called
- Verify database has correct timezone settings

### Last seen not updating
- Check if logout is updating admins.last_seen column
- Verify migration 020 was applied successfully
- Check database permissions for UPDATE on admins table

## Performance Considerations

- Heartbeat creates minimal load (1 UPDATE query per user per 30s)
- Session cleanup runs only when /sessions/active is called (not continuous)
- Consider adding a background job for cleanup if you have many concurrent users
- Indexes on active_sessions ensure fast lookups
