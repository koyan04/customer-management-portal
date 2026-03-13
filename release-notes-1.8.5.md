## What's Changed

### JSON Generator — Full xray/V2Ray Rewrite

The JSON Generator page now outputs native **xray/V2Ray** format instead of sing-box, so every field in V2Box's per-node editor is correctly populated.

#### Per-node V2Box fields now set on every outbound

| V2Box field | xray field |
|---|---|
| Utls | `streamSettings.tlsSettings.fingerprint` |
| SNI | `streamSettings.tlsSettings.serverName` |
| ALPN | `streamSettings.tlsSettings.alpn` |
| allow insecure | `streamSettings.tlsSettings.allowInsecure` |
| Fragment | `streamSettings.sockopt.dialerProxy` |
| Head Type | `streamSettings.tcpSettings.header.type` |
| PublicKey | `streamSettings.realitySettings.publicKey` |
| ShortId | `streamSettings.realitySettings.shortId` |
| SpiderX | `streamSettings.realitySettings.spiderX` |

#### Inbounds
- SOCKS proxy on port **10808**
- HTTP proxy on port **10809**
- TUN inbound removed — xray does not support TUN

#### Anti-DPI
- `freedom-fragment` outbound for TLS fragmentation
- Per-node `sockopt.dialerProxy: "freedom-fragment"` (V2Box shows as **Fragment: on**)
- `tlsSettings.fingerprint` for uTLS / Client Fingerprint

#### Node selection
- `observatory` + `routing.balancers` replace urltest/selector groups
- Strategy: `leastping` (or `roundRobin` when Load Balance is enabled)

#### Protocols supported
Shadowsocks · VMess · VLESS · VLESS+REALITY · Trojan · Hysteria2

---

**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.8.4...v1.8.5
