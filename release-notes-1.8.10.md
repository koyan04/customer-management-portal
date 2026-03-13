## What's Changed

### Bug Fix — V2Box Node Fields: Utls, ALPN, allowInsecure, PublicKey, ShortId "Not Set"

**Root cause**: When your V2Box subscribes to the `.json` URL, the keyserver converts the sing-box JSON to base64 proxy URIs (the standard V2Ray subscription format). The `outboundToURI` conversion function was missing several fields, so V2Box showed "Not Set" for Utls/fingerprint, ALPN, allowInsecure, and REALITY fields (PublicKey, ShortId).

Additionally, `buildSingboxTLS` in the frontend was not emitting `tls.utls.fingerprint` for TLS nodes when Anti-DPI was disabled — meaning the converted URI also had no `fp` field.

### Fixes

**keyserver.js — `outboundToURI`** (the function that converts sing-box outbounds to proxy URIs for V2Box):

| Protocol | Field | Before | After |
|---|---|---|---|
| VMess | Utls/fingerprint | Missing | `fp` field in vmess JSON |
| VMess | ALPN | Missing | `alpn` field in vmess JSON |
| VMess | allowInsecure | Missing | `allowInsecure` field |
| VLESS+REALITY | security | `security=tls` (wrong) | `security=reality` |
| VLESS+REALITY | PublicKey | Missing | `pbk` param |
| VLESS+REALITY | ShortId | Missing | `sid` param |
| VLESS+REALITY | Fingerprint | Missing | `fp` param |
| VLESS+TLS | ALPN | Missing | `alpn` param |
| VLESS+TLS | allowInsecure | Missing | `allowInsecure` param |
| Trojan | ALPN | Missing | `alpn` param |
| Trojan | allowInsecure | Missing | `allowInsecure` param |

**JsonGeneratorPage.jsx — `buildSingboxTLS`**:
- Always emit `tls.utls.fingerprint` for TLS nodes, defaulting to `clientFingerprint` ('random') — mirrors the v1.8.7 fix that was applied to xray format but was missing from the sing-box format

**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.8.9...v1.8.10
