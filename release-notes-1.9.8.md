# v1.9.8 — Keyserver Nginx Vhost Auto-Creation

## What's New

### Keyserver Vhost Auto-Creation
- The quick-fix script now **creates a missing nginx vhost** for the keyserver domain instead of just warning
- On fresh installs where no nginx `server_name` block exists for `key.*`, the script generates a complete HTTPS vhost with the correct SSL certificate paths and upstream to port `8088`
- This fixes the root cause of `SSL: no alternative certificate subject name matches target host name` — the domain was hitting the default nginx server block (which served the wrong certificate) because no vhost existed at all

## Bug Fixes

- Fixed `curl: (60) SSL: no alternative certificate subject name matches target host name 'key.vchannel.dpdns.org'` by creating the missing nginx vhost with the correct `server_name`, SSL certificate paths, and upstream proxy
- Previously the script only warned "No nginx vhost found" and did nothing — now it creates the full vhost automatically

## Upgrade Notes

No database migrations are required.

Run on the affected server:

```bash
sudo ./scripts/quick-fix-keyserver-tls.sh --domain key.vchannel.dpdns.org
```

## Verification

```bash
curl -v https://key.vchannel.dpdns.org/sub/403321bd3156bd36d6042dd154e8519f?key=88f24d617ed0fa519f02762c600ea8f7
```

Expected output:
- `subject: CN=key.vchannel.dpdns.org`
- No SSL errors
- Subscription data is returned