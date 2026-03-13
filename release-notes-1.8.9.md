## What's Changed

### Bug Fix — V2Box Shows 0 Usable Nodes

**Root cause**: v1.8.5 switched the JSON Generator from sing-box format to xray/V2Ray format. V2Box subscription parsing treats a sing-box JSON (outbounds with `type` field) as individual selectable nodes, but treats an xray JSON (outbounds with `protocol` field) as a single whole *"JSON config"* entry — showing only 1 node with a "JSON" badge and "timeout" status.

**Fix**: Reverted `generateJSON` and node converter back to sing-box format. All per-node improvements from v1.8.7/v1.8.8 are preserved.

### sing-box format (v1.8.9) features:
- `buildSingboxTLS`: REALITY (`tls.reality.public_key`, `tls.reality.short_id`, `tls.utls.fingerprint`)
- TLS: `tls.utls.fingerprint` from `clientFingerprint` state or URI `fp` param
- `tls.alpn` populated from `forceAlpn` toggle or node's ALPN, even without anti-DPI
- `allowInsecure` → `tls.insecure` (Anti-DPI panel control)
- Hysteria2: `tls.alpn: ["h3"]` + optional `utls` when anti-DPI enabled
- All 5 protocols: Shadowsocks, VMess, VLESS, VLESS+REALITY, Trojan, Hysteria2
- `useEffect` deps updated: `allowInsecure` + `forceAlpn` added

### Protocols output in sing-box format:
| Protocol | sing-box `type` |
|---|---|
| Shadowsocks | `shadowsocks` |
| VMess | `vmess` |
| VLESS | `vless` |
| VLESS+REALITY | `vless` + `tls.reality` |
| Trojan | `trojan` |
| Hysteria2 | `hysteria2` |

**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.8.8...v1.8.9
