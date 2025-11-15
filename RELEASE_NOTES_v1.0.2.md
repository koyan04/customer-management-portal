# Customer Management Portal – v1.0.2

Patch release adding a beginner-friendly Debian/Ubuntu bootstrap script.

## Change
- New `scripts/bootstrap.sh` installs prerequisites (git, curl, openssl, python3, Postgres, certbot, python3-certbot-dns-cloudflare) then runs the installer.
- README Quick Install now uses the bootstrap one-liner for simpler first-time setup.
- Direct installer one-liner retained for other distros.

## Bootstrap one-liner
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.2/scripts/bootstrap.sh | bash"
```

## Direct installer (non-Debian)
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.2/scripts/install.sh | bash"
```

## Changelog excerpt
See `CHANGELOG.md` entry for 1.0.2 (2025-11-10).
