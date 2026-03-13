# v1.8.15 — YAML Generator Hardening & Anti-DPI Defaults

## What's New

### YAML Generator — TUN Mode Always Included
- Generated YAML configs now always include a `tun:` block:
  ```yaml
  tun:
    enable: true
    stack: system
    mtu: 1400
    auto-route: true
    auto-detect-interface: true
  ```
- Ensures Mihomo/Clash operates as a transparent proxy without requiring manual TUN configuration in the client app

### YAML Generator — Proxy Group Health-Check Tuning
- **♻️ Auto Switch** (`url-test`): `tolerance: 150`, `lazy: true` added
- **⚡ Fastest** (`url-test`): `tolerance: 50`, `lazy: true` added
- **🛡️ Failover** (`fallback`): `lazy: true` added
- **⚖️ Load Balance / ⚖️ Static Balance**: `lazy: true` added
- `lazy: true` prevents unnecessary health checks when no connections are active, reducing overhead on low-traffic configs

### Anti-DPI Enabled by Default (YAML & JSON Generators)
- Both generators now default **Anti-DPI to ON** instead of requiring manual toggle
- YAML Generator default-on effects: `tcp-concurrent: true`, `global-client-fingerprint: random`, `keep-alive-interval: 30`, DoH DNS block
- JSON Generator default-on effects: sing-box output always includes `tls.utls.fingerprint` and DoH DNS
- Users can still disable Anti-DPI via the panel toggle

### Documentation — Full Guide Set Published
- **`YAML_GENERATOR_BOT_INSTRUCTIONS.md`** — copy-paste system prompt for AI bots generating Clash/Mihomo YAML configs
- **`YAML_GENERATOR_BOT_GUIDE.md`** — 12-section technical reference covering algorithms, parsing rules, domain mapping, anti-DPI, LB, upload, and verification checklist
- **`YAML_GENERATOR_USER_GUIDE.md`** — 14-section human-facing guide for admins using the YAML Generator UI
- **`JSON_GENERATOR_BOT_INSTRUCTIONS.md`** — updated: SS URI format `/?outline=1&prefix=`, 3 subscription URLs, mandatory domain/anti-DPI rules
- **`JSON_GENERATOR_BOT_GUIDE.md`** — updated: SS prefix field, 3-URL table, `data_limit_gb` metadata, Python snippet
- **`JSON_GENERATOR_USER_GUIDE.md`** — updated: 3-URL table (📋 Sub, 📦 Raw, ⚙️ V2Ray), corrected SS prefix note
- **`DEVELOPER_GUIDE.md`** — `POST /api/users/transfer` fully documented: request body, server-vs-domain table warning, all error codes, auth rules, 3-step lookup procedure

## Bug Fixes

- **Bot/API**: `POST /api/users/transfer` — added explicit documentation warning that `targetServerId` must come from `GET /api/servers`, not `GET /api/domains` (different tables; bots were sending domain IDs causing `Invalid target server ID` errors)
- **YAML Bot**: Anti-DPI and routing rules now mandated in bot instructions — bot was previously generating configs without them when not explicitly requested

## Upgrade Notes

No database migrations or backend configuration changes required.

Update via the GUI Update button or run:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/install.sh)
```
