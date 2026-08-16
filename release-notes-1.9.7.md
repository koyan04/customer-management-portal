# v1.9.7 — Keyserver SSL Certificate Path Repair

## What's New

### Keyserver SSL Certificate Path Repair
- The keyserver TLS quick-fix script now also repairs mismatched SSL certificate paths in the nginx vhost
- When the `key.*` domain's nginx config points to the wrong certificate (e.g., `ynparadise.dpdns.org` instead of `key.vchannel.dpdns.org`), the script rewrites both `ssl_certificate` and `ssl_certificate_key` to the correct `/etc/letsencrypt/live/<domain>/` paths
- This fixes the `invalid peer certificate: certificate is not valid for name` error that Clash Verge and other clients report when the nginx vhost loads the wrong certificate

## Bug Fixes

- Fixed `导入订阅失败: failed to fetch remote profile: static webpki roots fallback failed after platform TLS verifier failed: invalid peer certificate` by ensuring the nginx config for the keyserver domain loads the correct Let's Encrypt certificate

## Upgrade Notes

No database migrations are required.

If your keyserver domain is serving the wrong certificate after a fresh install, run:

```bash
sudo ./scripts/quick-fix-keyserver-tls.sh --domain key.vchannel.dpdns.org
```

## Verification

- Confirm `curl -v https://key.vchannel.dpdns.org/sub/...` shows the correct certificate (`subject: CN = key.vchannel.dpdns.org`)
- Confirm Clash Verge can import the subscription without TLS errors
- Confirm `nginx -t` passes after the fix