# Release Notes — v1.0.7

Date: 2025-11-10

## Installer Polish

Following a successful real VPS run and DNS-01 issuance, this patch release refines `scripts/install.sh` for clarity and control:

- Cloudflare Preflight: Verifies API token validity and attempts a zone lookup (non-fatal) to surface credential issues early.
- DNS Propagation Wait: New env `CMP_DNS_PROPAGATION_SECONDS` (default 10) passed to certbot's dns-cloudflare plugin.
- PostgreSQL Noise Reduction: Runs role/database creation from postgres' home directory to silence `could not change directory to "/root"` warnings.
- Always rewrites Cloudflare creds (added in 1.0.6) retained; token/zone checks added afterward.
- Minor wording and health probe output unchanged from 1.0.6.

## How to Install

Bootstrap (Debian/Ubuntu):
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.7/scripts/bootstrap.sh | bash"
```

Direct installer:
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.7/scripts/install.sh | bash"
```

Tune DNS propagation wait:
```bash
export CMP_DNS_PROPAGATION_SECONDS=20
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.7/scripts/install.sh | bash"
```

## Upgrade Notes

- No schema or data changes. Re-running the installer on an existing deployment is safe.
- If you previously had a mismatched Cloudflare creds format, it will be backed up and replaced again.
- To keep a specific earlier tag, set `CMP_CHECKOUT_REF=v1.0.6`; otherwise the bootstrap/installer uses v1.0.7.

## Integrity

Download and verify:
```bash
curl -fsSL -o install.sh https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.7/scripts/install.sh
sha256sum install.sh
```
Then optionally export `CMP_INSTALL_EXPECTED_SHA256` before running.
