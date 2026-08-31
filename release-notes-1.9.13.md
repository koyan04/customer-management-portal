# v1.9.13 — Key Server HTTPS, Live Secret Key, Installer Polish

## What's New

### Key Server HTTPS vhost reliability
- The installer previously wrote a broken HTTP-only vhost for the key server domain when no certificate existed, causing HTTPS requests to `key.…` to fall through to the portal's React app (404 / "Unexpected Application Error")
- The installer now **issues a Let's Encrypt certificate** for the key server domain (via HTTP-01) before writing the vhost
- The generated key server vhost now always includes a proper **HTTPS `listen 443 ssl` block** and an **HTTP→HTTPS redirect** when a certificate is present
- If certificate issuance genuinely fails, it falls back to a single HTTP vhost that proxies the key server directly (no more HTTPS falling through to the portal)

### Live key server secret key
- The `/sub/:id` handler now **reads the on-disk `keyserver.json` per request** instead of using a cached value captured at startup
- Updating the key server secret key (or config directory) in the GUI/on disk now takes effect immediately, **without restarting the backend**

### Installer UI polish
- Added a color banner, section headers, and status markers (`✔` / `-`) so install progress is clearer
- Fixed mojibake (`�…`) characters and corrected misleading logging

### Installer line-ending fix
- `install.sh` (and other tracked bash scripts) are now normalized to **LF** line endings and enforced via a new `.gitattributes` file
- Previously CRLF line endings (from Windows checkouts with `core.autocrlf=true`) could break shell parsing on Linux

## Bug Fixes

- Key server domain now correctly serves over HTTPS after installation
- Key server secret key updates apply immediately without a backend restart
- Installer runs cleanly on Linux (no `$'\r'` shell errors)

## Upgrade Notes

No database migrations are required.

If you previously installed with the broken HTTP-only key vhost, re-run the installer (or regenerate the key Nginx vhost) so the HTTPS block is applied.

## Verification

- After install, `curl -s "https://key.your-domain/sub/<id>?key=<key>"` returns the subscription config over HTTPS, not the React 404
- Changing the key server secret key in the GUI works immediately without restarting the backend
- Installer output shows a banner, section headers, and `✔` status markers