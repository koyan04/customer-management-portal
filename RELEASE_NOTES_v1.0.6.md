# Release Notes — v1.0.6

Date: 2025-11-10

## Highlights

This release focuses on making first‑time installs and re‑installs smoother, especially around certificate issuance with Cloudflare DNS.

- Certbot DNS-01 hardened:
  - The installer now always rewrites `/root/.cloudflare.ini` to match the chosen method (API Token or Global API Key). This prevents accidental mixes that lead to Cloudflare 6003 errors.
  - If the `dns-cloudflare` plugin is missing, the installer attempts to install it on Debian/Ubuntu systems.
- Multi-domain certificates:
  - You can request a certificate for multiple hostnames via the environment variable `CMP_CERT_DOMAINS` (comma or space separated). The primary domain is still prompted interactively.
- Optional HTTP fallback:
  - When `CMP_CERT_HTTP_FALLBACK=1` is set, the installer will attempt an HTTP‑01 issuance using certbot’s standalone mode if DNS‑01 fails.
- Post‑install health check:
  - After starting services, the installer probes `http://127.0.0.1:<PORT>/api/health` and prints a quick status.
- Skippable cert step:
  - Set `CMP_SKIP_CERT=1` to skip issuing certificates entirely (useful for later manual provisioning or air‑gapped setups).

## Suggested install commands

Debian/Ubuntu (prereqs + installer):

```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.6/scripts/bootstrap.sh | bash"
```

Direct installer (non‑Debian distros):

```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.6/scripts/install.sh | bash"
```

To pin a specific tag during installation:

```bash
export CMP_CHECKOUT_REF=v1.0.6
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.6/scripts/install.sh | bash"
```

To issue a multi‑domain certificate and enable HTTP fallback if DNS fails:

```bash
export CMP_CERT_DOMAINS="www.example.com api.example.com"
export CMP_CERT_HTTP_FALLBACK=1
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.6/scripts/install.sh | bash"
```

## Upgrade notes

- No schema changes. You can switch to v1.0.6 and re‑run the installer safely; it’s idempotent.
- If you previously created `/root/.cloudflare.ini` with the wrong format (key vs token), the installer will back it up and overwrite it with the correct fields.

## Integrity

If you download the installer to disk before execution, compute its SHA256 and optionally set `CMP_INSTALL_EXPECTED_SHA256` so the installer verifies itself.
