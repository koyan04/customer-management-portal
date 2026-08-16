# v1.9.9 — Keyserver Restore Upload Limit & Installer Key Server Setup

## What's New

### Key Server Backup/Restore Upload Limit Fixed
- Absolute restore of large key manager backups no longer fails with `Restore file is too large for server upload limit`
- Added a large-JSON pre-parser for `/api/keyserver` routes (raw-body with a `200mb` limit), matching the existing `/api/admin` handling
- Added `client_max_body_size 200m;` to the nginx configs the installer and the keyserver quick-fix script generate, overriding nginx's default 1MB body limit that was rejecting restore bundles with HTTP 413

### Installer Now Configures the Key Server Automatically
- The installation script now prompts for the key server public domain and port (default `8088`)
- It auto-generates a key server secret key (`openssl rand -hex 32`) unless one is provided
- Writes `backend/data/keyserver.json` with the port, secret key, config dir, `autoStart`, and `publicDomain` so the key server is ready to run immediately after install
- Default key/config directory is `/srv/cmp/configs`

## Bug Fixes

- Fixed the key manager restore failure caused by nginx's default 1MB body size limit
- Fixes the installer so the built-in key server is provisioned correctly on fresh installs

## Upgrade Notes

No database migrations are required.

If restoring a large key manager backup, ensure nginx allows large bodies:
```bash
sudo ./scripts/quick-fix-keyserver-tls.sh --domain key.example.com
```

For a fresh install, the installer will now prompt for the key server domain and configure everything automatically.

## Verification

- Restoring a large key manager backup returns success instead of the 413 "too large" error
- Fresh installs generate `backend/data/keyserver.json` with a valid secret key, correct domain/port, and `configDir` pointing at `/srv/cmp/configs`
- Confirm the key server auto-starts after install