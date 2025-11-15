# Customer Management Portal – v1.0.3

Patch release fixing interactive installer prompts for beginners.

## Changes
- `install.sh` now reads prompts from /dev/tty and errors with guidance if no TTY is available
- `bootstrap.sh` downloads the installer to a temp file and then executes it (no piping)

## Recommended one-liner (Debian/Ubuntu)
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.3/scripts/bootstrap.sh | bash"
```

## Direct installer (non-Debian)
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.3/scripts/install.sh | bash"
```

## Changelog excerpt
See `CHANGELOG.md` entry for 1.0.3 (2025-11-10).
