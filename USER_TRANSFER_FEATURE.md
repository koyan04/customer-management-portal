# User Transfer Feature Implementation

## Overview
Implemented a comprehensive user transfer feature that allows administrators to move users between servers. The feature is integrated into the Server List page with a dedicated modal interface.

## Backend Changes

### File: `backend/routes/users.js`
- **New Endpoint**: `POST /api/users/transfer`
  - **Authentication**: Admin only
  - **Input**: 
    - `userIds`: Array of user IDs to transfer
    - `targetServerId`: Target server ID
  - **Process**:
    - Validates inputs and target server existence
    - Uses database transaction for data integrity
    - Transfers users one by one with proper error handling
    - Updates `server_id` and assigns new `display_pos` values
    - Records audit trail for each transfer in `settings_audit` table
  - **Output**: Success message with count of transferred users

## Frontend Changes

### 1. New Component: `frontend/src/components/UserTransferModal.jsx`
A full-featured modal for transferring users between servers with:

**Features**:
- Server selection with dropdown (source and target)
- Visual arrow icon indicating transfer direction
- User list display with search functionality
- Checkbox selection for individual users
- "Select All" / "Deselect All" toggle button
- Real-time selection counter
- Transfer confirmation with loading state
- Success/error message display
- Auto-close after successful transfer

**UI Elements**:
- Source server dropdown
- Target server dropdown (excludes source server)
- Search bar for filtering users
- Scrollable user list with checkboxes
- Selected user count display
- Cancel and Transfer buttons

**User Experience**:
- Disabled target dropdown shows only available servers (not source)
- Search filters users by account_name, contact, or service_type
- Visual feedback with hover effects
- Loading states during data fetch and transfer
- Success message with 2-second auto-close

### 2. Updated Component: `frontend/src/pages/ServerList.jsx`
**Changes**:
- Added `UserTransferModal` import
- Added `showTransferModal` state
- Added "Transfer Users" button in toolbar (admin only)
- Button disabled during reorder mode
- Modal passes servers list and refresh callback

**Button Placement**:
- Located in list toolbar alongside "Reorder" button
- Only visible to admins
- Icon: `FaExchangeAlt` (exchange/transfer icon)
- Disabled when in reorder mode

### 3. CSS Updates: `frontend/src/App.css`
Added styling for transfer modal to support both themes:

**Dark Theme**:
- Dark glass-panel selects with subtle borders
- Muted text colors for readability
- Semi-transparent backgrounds

**Light Theme**:
- White glass-panel selects with mint tint
- Enhanced borders and shadows
- High contrast text colors
- Consistent with existing light theme design

## Features & Functionality

### User Selection
- ✅ View all users from selected source server
- ✅ Search/filter users by name, contact, service
- ✅ Individual checkbox selection
- ✅ Bulk "Select All" / "Deselect All"
- ✅ Visual selection counter
- ✅ Disabled state during operations

### Transfer Process
1. Select source server → loads users
2. Filter users with search (optional)
3. Select users to transfer (checkboxes)
4. Select target server
5. Click "Transfer N User(s)" button
6. Transaction-based transfer with audit logging
7. Success confirmation
8. Automatic refresh of both server lists

### Validation
- ✅ Requires at least one user selected
- ✅ Requires target server selection
- ✅ Prevents transfer to same server
- ✅ Server existence validation
- ✅ User existence validation
- ✅ Transaction rollback on errors

### Security
- ✅ Admin-only endpoint
- ✅ JWT authentication required
- ✅ Input validation on backend
- ✅ SQL injection protection (parameterized queries)
- ✅ Transaction-based operations
- ✅ Audit trail logging

### Error Handling
- ✅ Network error handling
- ✅ User-friendly error messages
- ✅ Transaction rollback on failure
- ✅ Skip non-existent users with warning
- ✅ Console logging for debugging

### Audit Trail
Each transfer records:
- Admin ID who performed transfer
- Settings key: 'users'
- Action: 'TRANSFER'
- Before data: Original user record (including old server_id)
- After data: Updated user record (including new server_id)

## Technical Details

### Database Operations
- Uses PostgreSQL transactions for atomicity
- Calculates next `display_pos` for target server
- Updates `server_id` and `display_pos` in single query
- Maintains referential integrity

### State Management
- React hooks for modal state
- Controlled form inputs
- Efficient Set data structure for selections
- Automatic state cleanup on close

### Performance Considerations
- Lazy loading of users (only when source selected)
- Client-side search/filtering
- Batch transfer in single transaction
- Minimal re-renders with proper state management

## Testing Checklist

- [ ] Transfer single user between servers
- [ ] Transfer multiple users in bulk
- [ ] Search and filter users before transfer
- [ ] Select all users and transfer
- [ ] Try to transfer with no selection (should show error)
- [ ] Try to transfer to same server (should show error)
- [ ] Cancel transfer modal
- [ ] Verify transferred users appear in target server
- [ ] Verify users removed from source server
- [ ] Check audit logs for transfer records
- [ ] Test with non-admin user (should not see button)
- [ ] Test in light and dark themes
- [ ] Test on mobile/responsive layout

## Files Modified

1. `backend/routes/users.js` - Added transfer endpoint
2. `frontend/src/components/UserTransferModal.jsx` - New modal component
3. `frontend/src/pages/ServerList.jsx` - Added transfer button and modal
4. `frontend/src/App.css` - Added transfer modal styling

## API Endpoint

```
POST /api/users/transfer
Authorization: Bearer <admin-token>
Content-Type: application/json

Request Body:
{
  "userIds": [1, 2, 3],
  "targetServerId": 5
}

Response (Success):
{
  "msg": "Successfully transferred 3 user(s)",
  "transferred": 3,
  "users": [...]
}

Response (Error):
{
  "msg": "Error message"
}
```

## Future Enhancements (Optional)

- [ ] Bulk transfer from multiple source servers
- [ ] Transfer with service type filter
- [ ] Preview before transfer
- [ ] Undo transfer functionality
- [ ] Transfer history view
- [ ] Export transfer audit logs
- [ ] Email notification on transfer
- [ ] Telegram notification on transfer

## Notes

- Feature is admin-only for security
- Uses database transactions to ensure data consistency
- Full audit trail for compliance
- Responsive design works on all screen sizes
- Follows existing UI/UX patterns in the application
