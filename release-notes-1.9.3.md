# v1.9.3 — Trojan YAML Generator Clash Mi Compatibility Fix

## What's New

### YAML Generator — Trojan WS/TLS Compatibility
- Trojan imports and exports now preserve TLS metadata more reliably for Clash Mi
- Trojan nodes now retain both `sni` and `servername` when present
- Trojan WS exports now include the TLS `security=tls` parameter and default ALPN for WS transport
- Client fingerprint is preserved through Trojan URI round-trips when available

## Bug Fixes

- Fixed Trojan + WS + TLS YAML output so it matches the working 3x-ui style layout used by Clash Mi
- Prevented domain remapping from dropping Trojan SNI/servername alignment

## Upgrade Notes

No database migrations or backend configuration changes are required.

## Verification

- Confirm Trojan WS/TLS YAML exports include `tls: true`, `servername`, `sni`, and `ws-opts`
- Confirm the app reports `cmp ver 1.9.3`