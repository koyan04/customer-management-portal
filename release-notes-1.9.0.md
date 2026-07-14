# v1.9.0 — Keyserver TLS Repair & Automatic Renewal Reloads

## What's New

### Keyserver TLS Quick-Fix Script
- Added `scripts/quick-fix-keyserver-tls.sh` to repair the most common keyserver TLS failure modes on production hosts
- The script can auto-detect the keyserver domain, repair a bad nginx upstream, and reinstall the renewal hook
- It is designed to recover from the exact case where `key.*` was still proxying to the main app instead of the keyserver port

### Automatic Renewal Reloads
- Certbot renewals now reload nginx after a successful certificate refresh
- Manual certificate renewals from the admin API also reload nginx automatically
- Update/install flows re-apply the renewal hook so the behavior survives redeploys

### Documentation
- README updated with the quick-fix workflow and the automatic renewal behavior
- Release notes updated for the new TLS repair and renewal path

## Bug Fixes

- Fixed the keyserver 404 scenario caused by an nginx vhost pointing the public domain at the wrong upstream port
- Reduced the chance of renewed certificates not being picked up until a manual nginx restart

## Upgrade Notes

No database migrations are required.

If you already have a working installation, run:
```bash
sudo ./scripts/quick-fix-keyserver-tls.sh
```

If you need to reissue a certificate, use the existing TLS repair flow in:
```bash
sudo ./scripts/fix-tls.sh YOUR_DOMAIN
```

## Verification

- Confirm the keyserver responds over HTTPS at the public sub URL
- Confirm `certbot renew` completes and nginx reloads without manual intervention
