## What's Changed

### Bug Fix — N (raw) shows 0 nodes; H (v2ray) can now be used as config import URL

**Root cause for N (raw, 0 nodes)**: The raw format was serving the full sing-box config including `selector`, `urltest`, `direct`, `dns`, `block` outbounds plus inbounds/routing/experimental. Sing-box-native clients (V2Box, NekoBox) could not parse this full config as a subscription — they showed 0 nodes.

**Fix for N**: Now serves `{"outbounds":[...proxy only...]}` — filters to only the 5 proxy outbound types (`shadowsocks`, `vmess`, `vless`, `trojan`, `hysteria2`). V2Box and other sing-box-native clients can parse this minimal JSON as a subscription and show individual selectable nodes.

**Fix for H**: Removed `Content-Disposition: attachment` header — the v2ray JSON config URL can now be used for direct config import in V2RayNG/Xray clients.

### Subscription format guide (after this fix):

| URL format | What it serves | Use with |
|---|---|---|
| default | base64 proxy URI list | V2Box · V2RayNG · any standard subscription client |
| `?format=raw` | proxy-only sing-box JSON | V2Box / NekoBox native sing-box subscription |
| `?format=v2ray` | full V2Ray/Xray JSON config | V2RayNG config import · Xray clients |

### Important: fragmentation / DoH / routing rules

These are JSON-config-level settings. They apply when the full sing-box JSON is used as a local config — they cannot be embedded in individual subscription proxy URIs.

To use fragmentation + DoH + custom routing in V2Box: save the config to server, then in V2Box use "Add Config from URL" (not "Add Subscription") with the raw URL (`?format=raw` but pointing at the full file). This imports the full sing-box JSON as a single local config entry with all Anti-DPI settings active.

**Full Changelog**: https://github.com/koyan04/customer-management-portal/compare/v1.8.10...v1.8.11
