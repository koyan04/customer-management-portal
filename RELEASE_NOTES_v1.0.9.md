# Release Notes v1.0.9

Date: 2025-11-10

## Highlights

### Automatic JWT Secret Generation
The installer now guarantees a valid `JWT_SECRET` is present in `backend/.env`:
- Fresh installs generate a 48-byte hex secret.
- Re-installs append a secret if missing or replace an empty `JWT_SECRET=` line without overwriting other values.
- Prevents login failures and `Token is not valid` UI errors caused by a missing secret.

### Startup Warning
Backend emits a clear warning on process start when `JWT_SECRET` is unset, guiding operators to re-run the installer or set the value manually.

### Documentation & Integrity
- README version bumped to `cmp ver 1.0.9` and notes JWT secret auto-generation in installer steps.
- Updated `scripts/install.sha256.baseline` with new installer hash.

## Upgrade Notes
- If you previously installed v1.0.8 (or earlier) and experienced auth failures, simply re-run the installer as root; it will append a secure JWT secret and restart the backend.
- Existing valid `JWT_SECRET` values are retained.
- After adding the secret, old access tokens become invalid—users should log in again.

## Security Considerations
- Generated secret length increased (48 bytes / 96 hex chars) for stronger entropy.
- Consider periodically rotating `JWT_SECRET` and invalidating refresh tokens if a compromise is suspected.

## Files Changed
- `scripts/install.sh`
- `backend/app.js`
- `CHANGELOG.md`
- `README.md`
- `VERSION`
- `scripts/install.sha256.baseline`
- Added: `RELEASE_NOTES_v1.0.9.md`

## Verification
Post-install, confirm:
1. `/srv/cmp/backend/.env` contains a non-empty `JWT_SECRET=` line.
2. `journalctl -u cmp-backend.service -n 50` shows no JWT warning.
3. Login succeeds and returns JSON `{ token: "..." }` plus a `refresh_token` httpOnly cookie.

## Next Steps (Optional)
- Add rate limiting on `/api/auth/login` via Nginx or an Express middleware.
- Implement token invalidation rotations scheduled (e.g., cron) if higher security posture required.

---
Thanks for using Customer Management Portal.
