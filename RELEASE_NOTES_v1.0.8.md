# Release Notes — v1.0.8

Date: 2025-11-10

## Optional Nginx Provisioning

Fresh installs succeeded but HTTPS page didn’t load because nothing listened on :443. The backend serves HTTP on the chosen port (default 3001) and we previously only issued certs. This release adds an optional Nginx setup step to terminate TLS and proxy to the backend.

- New: `CMP_ENABLE_NGINX=1` (or accept prompt) to install Nginx and generate a site config for your domain using `/etc/letsencrypt/live/<domain>/` certs.
- HTTP (80) redirects to HTTPS (443); ACME path is included.
- The site proxies `/` and `/uploads/` to `127.0.0.1:<PORT>`.

## Usage

Bootstrap:
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.8/scripts/bootstrap.sh | bash"
```

Direct install with Nginx:
```bash
sudo bash -lc "export CMP_ENABLE_NGINX=1; curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.8/scripts/install.sh | bash"
```

## Notes

- No migration changes.
- If you already have a reverse proxy, leave `CMP_ENABLE_NGINX` unset or answer `n` when prompted.
