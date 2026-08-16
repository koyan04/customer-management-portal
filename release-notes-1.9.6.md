# v1.9.6 — Keyserver TLS Quick-Fix Repair

## What's New

### Keyserver TLS Repair
- Fixed the keyserver TLS recovery helper so it detects nginx vhosts created under the normal fresh-install naming pattern
- The quick-fix script now finds the real `key.*` nginx config even when it lives in `sites-available` or `sites-enabled` under generated names like `cmp-<domain>.conf`
- It rewrites the bad backend proxy from the main app port `3001` to the keyserver port `8088` when the public keyserver domain is still pointing to the wrong upstream
- The certbot deploy hook is reinstalled and nginx is reloaded after the repair

### Release Alignment
- Bumped the repository version to `cmp ver 1.9.6`
- Updated the current version metadata in the README

## Bug Fixes

- Fixed the fresh-install keyserver TLS regression where a valid `key.*` domain still proxied to the main app instead of the keyserver service
- Prevented the repair helper from missing nginx configs created by the install flow on production hosts

## Upgrade Notes

No database migrations are required.

If your keyserver domain was misconfigured after a fresh install, run:

```bash
sudo ./scripts/quick-fix-keyserver-tls.sh --domain key.vchannel.dpdns.org
```

## Verification

- Confirm the script detects the domain and rewrites the upstream to `127.0.0.1:8088`
- Confirm nginx reloads successfully after the repair
- Confirm the keyserver responds correctly over HTTPS on the public domain
