# v1.9.10 — Keyserver Restore Upload Limit (Existing Vhosts)

## What's New

### Keyserver Quick-Fix Script: Large-Body Support for Existing Vhosts
- The keyserver quick-fix script now injects `client_max_body_size 200m;` into **existing** nginx vhosts for the domain, not just newly-created ones
- This permanently fixes the `Restore file is too large for server upload limit` error on production hosts that were already configured (where the nginx vhost lacked the body-size directive and nginx rejected restore bundles over 1MB with HTTP 413)
- The fix also applies to the primary vhost that serves the Key Manager page's same-origin restore request

### Improved Domain Auto-Detection
- The quick-fix script can now auto-detect the keyserver domain from `cmp-*.conf` vhost files (the naming pattern fresh installs create), so running it without `--domain` works on standard installs

## Bug Fixes

- Fixed restore of large key manager backups failing with `Restore file is too large for server upload limit` on existing deployments where nginx's default 1MB body limit was active
- nginx now allows up to 200MB JSON payloads for keyserver backup/restore traffic

## Upgrade Notes

No database migrations are required.

On an affected host, run:

```bash
sudo ./scripts/quick-fix-keyserver-tls.sh --domain key.example.com
```

This adds `client_max_body_size 200m` to the keyserver and primary vhosts, tests the nginx config, and reloads.

## Verification

- A restore bundle larger than 1MB is accepted through nginx (no more 413)
- The quick-fix script reports it added `client_max_body_size` to existing vhosts
- `nginx -t` passes after the change