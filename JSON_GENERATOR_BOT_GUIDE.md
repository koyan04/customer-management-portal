# JSON Generator Bot Guide

Complete reference for bots/automation that need to programmatically generate **xray/V2Ray** JSON config files, replicating the exact output of the JSON Generator page (`/json-generator`).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Common Bot Mistakes](#2-common-bot-mistakes)
3. [Required API Calls](#3-required-api-calls)
4. [Step-by-Step Algorithm](#4-step-by-step-algorithm)
5. [Parsing Proxy URIs](#5-parsing-proxy-uris)
6. [Node Name Formula](#6-node-name-formula)
7. [Domain Server Selection](#7-domain-server-selection)
8. [Node Deduplication](#8-node-deduplication)
9. [Converting Nodes to xray/V2Ray Format](#9-converting-nodes-to-xrayv2ray-format)
10. [Full Config Structure](#10-full-config-structure)
11. [Default App Routing](#11-default-app-routing)
12. [Advanced Settings Reference](#12-advanced-settings-reference)
13. [Anti-DPI Mode](#13-anti-dpi-mode)
14. [Load Balance Mode](#14-load-balance-mode)
15. [Uploading to Key Server](#15-uploading-to-key-server)
16. [Complete Python Reference Implementation](#16-complete-python-reference-implementation)
17. [Verification Checklist](#17-verification-checklist)

---

## 1. Overview

The JSON Generator page builds an **xray/V2Ray** format JSON config file. It is NOT Clash YAML, NOT sing-box JSON — it is specifically the [xray-core](https://github.com/XTLS/Xray-core) / V2Ray format, which is natively supported by V2Box and other xray-based clients.

The generator takes:
- A group name (e.g. `VChannel-Premium`)
- One or more proxy URIs (`ss://`, `vmess://`, `vless://`, `trojan://`, `hy2://`)
- A domain server selection per node (from the `/api/domains` pool)
- Optional settings (unlimited plan, data limit, expiry, anti-DPI, load balance)

And produces a complete xray/V2Ray config with:
- SOCKS (port 10808) + HTTP (port 10809) inbounds
- Individual node outbounds in xray format with full `streamSettings` (network, security, TLS, ALPN, fingerprint, sockopt)
- Observatory + balancer for automatic node selection (`leastping` or `roundRobin`)
- Full routing rules for 19 built-in apps in xray `type: "field"` format
- Anti-DPI: `freedom-fragment` outbound + per-node `sockopt.dialerProxy` for TLS fragmentation

---

## 2. Common Bot Mistakes

These are the most frequent errors when bots generate configs manually instead of following the algorithm:

| # | Mistake | Wrong | Correct |
|---|---|---|---|
| 1 | Node tags | `"node-1"`, `"node-2"` | `"🇸🇬 VChannel-Premium (Unlimited) SG01"` |
| 2 | Server addresses | Raw IPs: `"159.89.207.135"` | Domain names: `"pul01.vchannel.dpdns.org"` |
| 3 | Wrong format | sing-box format (`type`, `server_port`, `tls.enabled`) | xray format (`protocol`, `port`, `streamSettings.security`) |
| 4 | SS with plugin | `"plugin": "obfs-local"` in settings | No plugin field — xray SS uses `streamSettings` for transport |
| 5 | Missing `streamSettings` | Bare `settings` only | Every node needs `streamSettings` with `network`, `security`, and transport-specific block |
| 6 | Missing balancer | No auto-selection | `routing.balancers` + `observatory` required for leastping auto-switch |
| 7 | Sing-box inbounds | `type: "tun"`, `type: "mixed"` | xray inbounds: `protocol: "socks"` (10808) + `protocol: "http"` (10809) |
| 8 | Sing-box routing | `route.rules[].domain_suffix`, `ip_cidr` | xray routing: `routing.rules[].type: "field"`, `domain`, `ip` |
| 9 | Missing routing rules | 5–10 domains | Full 19-app rule set in xray field format |
| 10 | Anti-DPI: sing-box fields | `tls_fragment`, `dial_fields`, `tls.utls` | xray: `freedom-fragment` outbound + `sockopt.dialerProxy` + `tlsSettings.fingerprint` |
| 11 | Wrong `allowInsecure` | Not set (defaults to false in V2Box) | Always set `"allowInsecure": true` in `tlsSettings` when bypassing cert verify |

**Root cause of all mistakes:** The bot wrote the config by hand instead of replicating `generateJSON()`. Always follow the algorithm in Section 4.

---

## 3. Required API Calls

All calls require an admin JWT token in the `Authorization: Bearer <token>` header.

### 3.1 Search for a User

```http
GET /api/users/search?q=<name>
```

Response fields used:
- `account_name` — used to derive filename suffix
- `expire_date` — ISO date string, used as metadata
- `service_type` — `"unlimited"`, `"premium"`, `"basic"`, `"mini"` etc.

### 3.2 Get Domain Server List

```http
GET /api/domains
```

Response (array of domain objects):
```json
[
  { "id": 1, "domain": "pul01.vchannel.dpdns.org", "server": "SG01", "service": "Premium", "unlimited": true },
  { "id": 2, "domain": "pul02.vchannel.dpdns.org", "server": "SG02", "service": "Premium", "unlimited": true },
  { "id": 3, "domain": "pb01.vchannel.dpdns.org",  "server": "SG01", "service": "Premium", "unlimited": false },
  { "id": 4, "domain": "ps01.vchannel.dpdns.org",  "server": "SG01", "service": "Basic",   "unlimited": false }
]
```

Fields:
- `id` — unique identifier
- `domain` — the FQDN to use as the node's server address
- `server` — short code like `"SG01"`, `"HK02"` — used for the node name
- `service` — `"Premium"` or `"Basic"`
- `unlimited` — `true` for Unlimited plan pool

### 3.3 Get Key Server Config

```http
GET /api/keyserver/config
```

Response:
```json
{ "port": 8088, "secretKey": "abc123", "publicDomain": "key.example.com", "configDir": "/etc/keyserver" }
```

Used to build the subscription URL.

### 3.4 Upload Config File

```http
POST /api/keyserver/keys
Content-Type: application/json

{
  "filename": "vchannel-config-username.json",
  "content": "{ ... sing-box config json string ... }",
  "metadata": {
    "expire_date": "2026-12-31",
    "data_limit_gb": 150,
    "unlimited": true
  }
}
```

Response:
```json
{ "filename": "vchannel-config-username.json", "token": "<uuid-token>" }
```

### 3.5 Build Subscription URL

```
{publicDomain}/sub/{token}?key={secretKey}
```

If `publicDomain` includes a port or protocol already, use it as-is. If not, prepend `http://` and append `:{port}`.

---

## 4. Step-by-Step Algorithm

```
INPUT:
  groupName       string   e.g. "VChannel-Premium"
  unlim           bool     true if user has Unlimited plan
  proxyURIs       []string list of ss://, vmess://, vless://, trojan://, hy2:// URIs
  domainEntries   []object parallel list of domain objects (one per proxy URI)
  options         object   { dataLimit, expireDate, loadBalance, staticBalance,
                             autoSwitchInterval, checkInterval, globalDefault,
                             antiDPI, ... }

STEP 1 — Parse each proxy URI
  node = parseProxyURI(proxyURIs[i])
  // Extracts: type, server (raw), port, cipher/password/uuid/etc.

STEP 2 — Apply domain server override
  node.server      = domainEntries[i].domain
  node.servername  = domainEntries[i].domain  (if present)
  node.sni         = domainEntries[i].domain  (if present)
  node.ws-opts.headers.Host = domainEntries[i].domain  (if WebSocket)

STEP 3 — Build node name
  countryCode = domainEntries[i].server[:2].toUpperCase()  // "SG01" → "SG"
  flag        = FLAG_MAP[countryCode]                       // "SG" → "🇸🇬"
  unlimLabel  = domainEntries[i].unlimited ? " (Unlimited)" : ""
  node.name   = f"{flag} {groupName}{unlimLabel} {domainEntries[i].server}".strip()

STEP 4 — Deduplicate names
  If multiple nodes end up with the same name, append A, B, C... to each duplicate.

STEP 5 — Convert each node to sing-box outbound
  sbOutbound = convertNodeToSingbox(node)   // see Section 9

STEP 6 — Build full config object
  config = buildConfig(sbOutbounds, options)  // see Section 10

STEP 7 — Serialize and upload
  content  = JSON.stringify(config, indent=2)
  filename = f"{filePrefix}-{fileSuffix}.json"
  POST /api/keyserver/keys  { filename, content, metadata }
```

---

## 5. Parsing Proxy URIs

### 5.1 Shadowsocks (`ss://`)

Format: `ss://BASE64(cipher:password)@host:port#name`

Extracted fields:
```
type     = "ss"
server   = url.hostname       ← will be replaced with domain
port     = int(url.port)
cipher   = first part of base64-decoded userinfo (e.g. "chacha20-ietf-poly1305")
password = second part of base64-decoded userinfo
udp      = true
```

> ⚠️ **Plugin/obfs fields in the URI are completely ignored.** `parseShadowsocks()` does not read `?plugin=` or `?obfs=`. Do NOT manually add obfs fields to the sing-box output. Sing-box's Shadowsocks outbound format does not have a `plugin` field.

### 5.2 VMess (`vmess://`)

Format: `vmess://BASE64(JSON)`

The base64 decodes to a JSON object. Extracted fields:
```
type      = "vmess"
server    = json.add
port      = int(json.port)
uuid      = json.id
alterId   = int(json.aid || 0)
cipher    = json.scy || "auto"
network   = json.net              (e.g. "ws", "grpc", "tcp")
tls       = json.tls === "tls"
servername = json.host
ws-opts   = { path: json.path, headers: { Host: json.host } }  if network="ws"
```

### 5.3 VLESS (`vless://`)

Format: `vless://uuid@host:port?params#name`

Extracted fields:
```
type               = "vless"
server             = url.hostname
port               = int(url.port)
uuid               = url.username
network            = params.get("type") or params.get("network")
tls                = params.get("security") === "tls"
servername         = params.get("sni")
client-fingerprint = params.get("fp") || "chrome"
flow               = params.get("flow")  (only if network !== "ws")
ws-opts            = { path: params.get("path"), headers: { Host: params.get("host") } }
```

### 5.4 Trojan (`trojan://`)

Format: `trojan://password@host:port?params#name`

Extracted fields:
```
type     = "trojan"
server   = url.hostname
port     = int(url.port)
password = url.username (URL-decoded)
sni      = params.get("sni")
network  = params.get("type")
ws-opts  = { path, headers: { Host } }  if network="ws"
```

### 5.5 Hysteria2 (`hy2://` or `hysteria2://`)

Format: `hy2://password@host:port?sni=...#name`

Extracted fields:
```
type     = "hysteria2"
server   = url.hostname
port     = int(url.port)
password = url.username (URL-decoded)
sni      = params.get("sni") || url.hostname
```

---

## 6. Node Name Formula

Node names are used as the `tag` in sing-box outbounds, and as the display name in the selector.

### Formula

```
flag       = FLAG_MAP[server[:2].upper()]   # "SG01" → FLAG_MAP["SG"] → "🇸🇬"
unlimLabel = " (Unlimited)" if domain_entry.unlimited else ""
nodeName   = f"{flag} {groupName}{unlimLabel} {domain_entry.server}".strip()
```

### Flag Map

| Code | Flag | Code | Flag |
|---|---|---|---|
| SG | 🇸🇬 | TH | 🇹🇭 |
| HK | 🇭🇰 | VN | 🇻🇳 |
| US | 🇺🇸 | UK | 🇬🇧 |
| JP | 🇯🇵 | CN | 🇨🇳 |
| ID | 🇮🇩 | IN | 🇮🇳 |
| AU | 🇦🇺 | | |

### Examples

| groupName | domain_entry.server | domain_entry.unlimited | Result |
|---|---|---|---|
| VChannel-Premium | SG01 | true | `🇸🇬 VChannel-Premium (Unlimited) SG01` |
| VChannel-Premium | SG01 | false | `🇸🇬 VChannel-Premium SG01` |
| VChannel-Basic | HK01 | false | `🇭🇰 VChannel-Basic HK01` |
| MyVPN | US02 | true | `🇺🇸 MyVPN (Unlimited) US02` |

### Duplicate Name Handling

If two nodes end up with the same name (e.g. same server code appears twice), append letter suffixes:
```
"🇸🇬 VChannel-Premium (Unlimited) SG01 A"
"🇸🇬 VChannel-Premium (Unlimited) SG01 B"
```

---

## 7. Domain Server Selection

### 7.1 Filter by Plan Type

```python
# Input: domains = response from GET /api/domains

# For Unlimited plan users:
filtered = [d for d in domains if d["unlimited"] == True]

# For Premium (non-unlimited) plan users:
filtered = [d for d in domains if d["service"] == "Premium" and not d["unlimited"]]

# For Basic/Mini plan users:
filtered = [d for d in domains if d["service"] == "Basic"]
```

### 7.2 Pairing Nodes to Domains

The standard approach is **positional**: proxy URI 1 uses domain entry 1, URI 2 uses domain entry 2, etc.

If there are more proxy URIs than domain entries, cycle through the domain list.

### 7.3 What Gets Overridden

When assigning a domain entry to a node, the following fields are replaced:

```python
node["server"]          = domain_entry["domain"]   # e.g. "pul01.vchannel.dpdns.org"

# For WebSocket nodes:
node["ws-opts"]["headers"]["Host"] = domain_entry["domain"]

# For TLS nodes:
node["servername"] = domain_entry["domain"]

# For Trojan/Hysteria2 nodes:
node["sni"] = domain_entry["domain"]
```

---

## 8. Node Deduplication

Two deduplication passes are applied when processing multiple nodes:

### 8.1 Domain Auto-Increment (Bulk Add only)

When multiple nodes are added at once that share the same raw server hostname (e.g. `pb01.vchannel.dpdns.org` appears 3 times), the generator auto-increments the domain number:

```
pb01.vchannel.dpdns.org → pb01 (1st)
pb01.vchannel.dpdns.org → pb02 (2nd)
pb01.vchannel.dpdns.org → pb03 (3rd)
```

Supported hostname prefixes: `pb`, `pul`, `ou`, `ps` (case-insensitive).

### 8.2 Name Deduplication (Always applied)

If two nodes have the same final name tag, append alphabetic suffixes:
```
"🇸🇬 VChannel-Premium SG01"   → "🇸🇬 VChannel-Premium SG01 A"
"🇸🇬 VChannel-Premium SG01"   → "🇸🇬 VChannel-Premium SG01 B"
```

> **Bot note:** When using `addSingleNode` (one URI + one domain selection at a time), domain auto-increment is NOT applied — only name deduplication. Auto-increment only happens during bulk processing.

---

## 9. Converting Nodes to xray/V2Ray Format

All nodes use xray's outbound structure: `protocol` + `settings` (protocol-specific) + `streamSettings` (transport + TLS + sockopt).

### 9.1 Shadowsocks

```json
{
  "tag": "<nodeName>",
  "protocol": "shadowsocks",
  "settings": {
    "servers": [{
      "address": "<domain_entry.domain>",
      "port": <port>,
      "method": "<cipher>",
      "password": "<password>",
      "uot": true,
      "uotVersion": 2
    }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "none",
    "tcpSettings": { "header": { "type": "none" } },
    "sockopt": { "TcpFastOpen": true, "tcpMptcp": true }
  },
  "mux": { "enabled": false }
}
```

`"sockopt"` is only included when anti-DPI tcpConcurrent is on. `tcpSettings.header.type` corresponds to the "Head Type" field shown in V2Box's node editor.

### 9.2 VMess

```json
{
  "tag": "<nodeName>",
  "protocol": "vmess",
  "settings": {
    "vnext": [{
      "address": "<domain>",
      "port": <port>,
      "users": [{ "id": "<uuid>", "alterId": 0, "security": "<cipher or 'auto'>", "level": 8 }]
    }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "tls",
    "tlsSettings": {
      "serverName": "<sni>",
      "allowInsecure": true,
      "fingerprint": "<clientFingerprint>",
      "alpn": ["h2", "http/1.1"]
    },
    "tcpSettings": { "header": { "type": "none" } }
  },
  "mux": { "enabled": false }
}
```

With WebSocket transport, replace `tcpSettings` with:
```json
"wsSettings": {
  "path": "<path>",
  "headers": { "Host": "<host>" }
}
```

`"fingerprint"` and `"alpn"` inside `tlsSettings` are the xray equivalents of V2Box's "Utls" and "ALPN" fields.

### 9.3 VLESS (TLS)

```json
{
  "tag": "<nodeName>",
  "protocol": "vless",
  "settings": {
    "vnext": [{
      "address": "<domain>",
      "port": <port>,
      "users": [{ "id": "<uuid>", "flow": "<flow or ''>", "encryption": "none", "level": 8 }]
    }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "tls",
    "tlsSettings": {
      "serverName": "<sni>",
      "allowInsecure": true,
      "fingerprint": "<clientFingerprint>",
      "alpn": ["h2", "http/1.1"]
    },
    "tcpSettings": { "header": { "type": "none" } }
  },
  "mux": { "enabled": false }
}
```

### 9.3b VLESS (REALITY)

```json
{
  "tag": "<nodeName>",
  "protocol": "vless",
  "settings": {
    "vnext": [{
      "address": "<domain>",
      "port": <port>,
      "users": [{ "id": "<uuid>", "flow": "xtls-rprx-vision", "encryption": "none", "level": 8 }]
    }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "reality",
    "realitySettings": {
      "serverName": "<sni>",
      "fingerprint": "<clientFingerprint>",
      "publicKey": "<publicKey>",
      "shortId": "<shortId>",
      "spiderX": "/"
    },
    "tcpSettings": { "header": { "type": "none" } }
  },
  "mux": { "enabled": false }
}
```

These map directly to V2Box's "TLS: reality" view fields: PublicKey, ShortId, SpiderX, Utls (fingerprint).

### 9.4 Trojan

```json
{
  "tag": "<nodeName>",
  "protocol": "trojan",
  "settings": {
    "servers": [{ "address": "<domain>", "port": <port>, "password": "<password>", "level": 8 }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "tls",
    "tlsSettings": {
      "serverName": "<sni>",
      "allowInsecure": true,
      "fingerprint": "<clientFingerprint>",
      "alpn": ["h2", "http/1.1"]
    },
    "tcpSettings": { "header": { "type": "none" } }
  },
  "mux": { "enabled": false }
}
```

### 9.5 Hysteria2

Hysteria2 uses V2Box's dedicated Hysteria2 core (not xray). Output format:

```json
{
  "tag": "<nodeName>",
  "protocol": "hysteria2",
  "settings": {
    "servers": [{ "address": "<domain>", "port": <port>, "password": "<password>" }]
  },
  "streamSettings": {
    "network": "udp",
    "security": "tls",
    "tlsSettings": {
      "serverName": "<sni>",
      "allowInsecure": true,
      "fingerprint": "<clientFingerprint>",
      "alpn": ["h3"]
    }
  }
}
```

### 9.6 Anti-DPI sockopt (per-node)

When anti-DPI is on, add `sockopt` inside `streamSettings` of every node:

```json
"sockopt": {
  "TcpFastOpen": true,
  "tcpMptcp": true,
  "dialerProxy": "freedom-fragment"
}
```

`"dialerProxy"` routes TLS handshake through the `freedom-fragment` outbound (TLS Hello fragmentation). Omit `"dialerProxy"` if `tlsFragment` is off.

---

## 10. Full Config Structure

### 10.1 Default Config (Anti-DPI off, Load Balance off)

This is the standard xray/V2Ray output. Every field shown is always present.

```json
{
  "log": { "loglevel": "warning", "access": "none" },

  "dns": {
    "servers": ["8.8.8.8", "1.1.1.1", "localhost"]
  },

  "inbounds": [
    {
      "tag": "socks",
      "port": 10808,
      "listen": "127.0.0.1",
      "protocol": "socks",
      "settings": { "auth": "noauth", "udp": true },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
    },
    {
      "tag": "http",
      "port": 10809,
      "listen": "127.0.0.1",
      "protocol": "http",
      "settings": {},
      "sniffing": { "enabled": true, "destOverride": ["http", "tls"] }
    }
  ],

  "outbounds": [
    {
      "tag": "🇸🇬 VChannel-Premium (Unlimited) SG01",
      "protocol": "shadowsocks",
      "settings": {
        "servers": [{
          "address": "pul01.vchannel.dpdns.org",
          "port": 8388,
          "method": "chacha20-ietf-poly1305",
          "password": "your-password-here",
          "uot": true,
          "uotVersion": 2
        }]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "none",
        "tcpSettings": { "header": { "type": "none" } }
      },
      "mux": { "enabled": false }
    },
    {
      "tag": "🇸🇬 VChannel-Premium (Unlimited) SG02",
      "protocol": "shadowsocks",
      "settings": {
        "servers": [{
          "address": "pul02.vchannel.dpdns.org",
          "port": 8388,
          "method": "chacha20-ietf-poly1305",
          "password": "your-password-here",
          "uot": true,
          "uotVersion": 2
        }]
      },
      "streamSettings": {
        "network": "tcp",
        "security": "none",
        "tcpSettings": { "header": { "type": "none" } }
      },
      "mux": { "enabled": false }
    },
    { "tag": "direct",  "protocol": "freedom",    "settings": {} },
    { "tag": "dns-out", "protocol": "dns" },
    { "tag": "block",   "protocol": "blackhole",  "settings": {} }
  ],

  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "domainMatcher": "hybrid",
    "rules": [
      { "type": "field", "protocol": ["dns"], "port": "53", "outboundTag": "dns-out" },
      { "type": "field", "ip": ["geoip:private"], "outboundTag": "direct" },
      {
        "type": "field",
        "domain": [
          "netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net",
          "youtube.com", "googlevideo.com", "ytimg.com", "yt.be", "youtu.be",
          "youtube-nocookie.com", "yt3.ggpht.com",
          "facebook.com", "fbcdn.net", "fb.com", "fb.me", "fbsbx.com",
          "fbpigeon.com", "fb.gg", "facebook.net", "facebookcorewwwi.onion",
          "accountkit.com", "freebasics.com",
          "keyword:facebook", "keyword:fbcdn",
          "instagram.com", "cdninstagram.com", "ig.me", "instagram.net", "keyword:instagram",
          "messenger.com", "m.me", "msngr.com", "keyword:messenger",
          "threads.net", "threads.com", "keyword:threads",
          "twitter.com", "twimg.com", "x.com", "t.co",
          "twittercdn.com", "twitterstat.us", "twttr.com", "keyword:twitter",
          "tiktok.com", "tiktokcdn.com", "tiktokv.com", "tiktokcdn-us.com", "musical.ly", "keyword:tiktok",
          "whatsapp.com", "whatsapp.net", "wa.me", "keyword:whatsapp",
          "telegram.org", "t.me", "telegra.ph", "telegram.me", "telegram.dog", "telesco.pe",
          "discord.com", "discordapp.com", "discordapp.net", "discord.gg", "discord.media", "keyword:discord",
          "spotify.com", "scdn.co", "spotify.design", "spotifycdn.com",
          "signal.org", "whispersystems.org", "signal.art",
          "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com",
          "github.com", "githubusercontent.com", "github.io", "githubassets.com"
        ],
        "balancerTag": "balancer-auto"
      },
      {
        "type": "field",
        "ip": [
          "31.13.24.0/21", "31.13.64.0/18", "45.64.40.0/22", "66.220.144.0/20",
          "69.63.176.0/20", "69.171.224.0/19", "74.119.76.0/22", "102.132.96.0/20",
          "103.4.96.0/22", "129.134.0.0/17", "157.240.0.0/17", "173.252.64.0/18",
          "179.60.192.0/22", "185.60.216.0/22", "185.89.218.0/23", "204.15.20.0/22",
          "2620:0:1c00::/40", "2a03:2880::/32",
          "69.171.250.0/24", "31.13.86.0/24",
          "18.194.0.0/15", "34.224.0.0/12", "50.19.0.0/16", "52.0.0.0/11",
          "91.108.4.0/22", "91.108.8.0/21", "91.108.16.0/21", "91.108.56.0/22",
          "95.161.64.0/20", "149.154.160.0/20",
          "2001:67c:4e8::/48", "2001:b28:f23d::/48",
          "13.248.212.0/24", "76.223.92.0/24"
        ],
        "balancerTag": "balancer-auto"
      },
      {
        "type": "field",
        "domain": [
          "google.com", "googleapis.com", "gstatic.com",
          "microsoft.com", "live.com", "msn.com",
          "apple.com", "icloud.com",
          "amazon.com", "amazonaws.com"
        ],
        "outboundTag": "direct"
      },
      { "type": "field", "network": "tcp,udp", "balancerTag": "balancer-auto" }
    ],
    "balancers": [{
      "tag": "balancer-auto",
      "selector": [
        "🇸🇬 VChannel-Premium (Unlimited) SG01",
        "🇸🇬 VChannel-Premium (Unlimited) SG02"
      ],
      "strategy": { "type": "leastping" }
    }]
  },

  "observatory": {
    "subjectSelector": [
      "🇸🇬 VChannel-Premium (Unlimited) SG01",
      "🇸🇬 VChannel-Premium (Unlimited) SG02"
    ],
    "probeUrl": "http://www.gstatic.com/generate_204",
    "probeInterval": "900s",
    "enableConcurrency": true
  }
}
```

### 10.2 Key Structural Rules

- `outbounds` order: node outbounds (in order) → `freedom-fragment` (if anti-DPI) → `direct` → `dns-out` → `block`
- All traffic routing is via `balancerTag` (proxy apps) or `outboundTag: "direct"` — NO selector outbound needed
- `routing.balancers[0].strategy.type`:
  - `"leastping"` — latency-based auto-select (default, equivalent to urltest)
  - `"roundRobin"` — round-robin rotation (when `loadBalance = true`)
- `observatory.probeInterval` is driven by `autoSwitchInterval` setting (default 900s)
- `route.final` concept from sing-box is replaced by a final catch-all rule: `{ "type": "field", "network": "tcp,udp", "balancerTag": "balancer-auto" }` (or `outboundTag: "direct"` if globalDefault = Direct)
- xray `domain` field in routing rules handles both suffix and keyword in one array:
  - `"domain.com"` = domain suffix match (includes `*.domain.com`)
  - `"keyword:word"` = keyword match
- xray `ip` field handles both IPv4 and IPv6 CIDRs in the same array
- `allowInsecure: true` in `tlsSettings` = V2Box "allow insecure: true"
- `fingerprint` in `tlsSettings` = V2Box "Utls" field

---

## 11. Default App Routing

The generator has 19 built-in apps. Each has a default routing assignment that the user can change.

### Default assignments (out of the box)

| App | Default | domain_suffix | domain_keyword | ip_cidr |
|---|---|---|---|---|
| Netflix | **proxy** | netflix.com, nflxvideo.net, nflximg.net, nflxext.com, nflxso.net | — | — |
| YouTube | **proxy** | youtube.com, googlevideo.com, ytimg.com, yt.be, youtu.be, youtube-nocookie.com, yt3.ggpht.com | — | — |
| Facebook | **proxy** | facebook.com, fbcdn.net, fb.com, fb.me, fbsbx.com, fbpigeon.com, fb.gg, facebook.net, facebookcorewwwi.onion, accountkit.com, freebasics.com | facebook, fbcdn | 31.13.24.0/21, 31.13.64.0/18, 45.64.40.0/22, 66.220.144.0/20, 69.63.176.0/20, 69.171.224.0/19, 74.119.76.0/22, 102.132.96.0/20, 103.4.96.0/22, 129.134.0.0/17, 157.240.0.0/17, 173.252.64.0/18, 179.60.192.0/22, 185.60.216.0/22, 185.89.218.0/23, 204.15.20.0/22, 2620:0:1c00::/40, 2a03:2880::/32 |
| Instagram | **proxy** | instagram.com, cdninstagram.com, ig.me, instagram.net | instagram | — |
| Messenger | **proxy** | messenger.com, m.me, msngr.com | messenger | 69.171.250.0/24, 31.13.86.0/24 |
| Threads | **proxy** | threads.net, threads.com | threads | — |
| Twitter | **proxy** | twitter.com, twimg.com, x.com, t.co, twittercdn.com, twitterstat.us, twttr.com | twitter | — |
| TikTok | **proxy** | tiktok.com, tiktokcdn.com, tiktokv.com, tiktokcdn-us.com, musical.ly | tiktok | — |
| WhatsApp | **proxy** | whatsapp.com, whatsapp.net, wa.me | whatsapp | 18.194.0.0/15, 34.224.0.0/12, 50.19.0.0/16, 52.0.0.0/11 |
| Telegram | **proxy** | telegram.org, t.me, telegra.ph, telegram.me, telegram.dog, telesco.pe | — | 91.108.4.0/22, 91.108.8.0/21, 91.108.16.0/21, 91.108.56.0/22, 95.161.64.0/20, 149.154.160.0/20, 2001:67c:4e8::/48, 2001:b28:f23d::/48 |
| Signal | **proxy** | signal.org, whispersystems.org, signal.art | — | 13.248.212.0/24, 76.223.92.0/24 |
| Discord | **proxy** | discord.com, discordapp.com, discordapp.net, discord.gg, discord.media | discord | — |
| Spotify | **proxy** | spotify.com, scdn.co, spotify.design, spotifycdn.com | — | — |
| ChatGPT | **proxy** | openai.com, chatgpt.com, oaistatic.com, oaiusercontent.com | — | — |
| GitHub | **proxy** | github.com, githubusercontent.com, github.io, githubassets.com | — | — |
| Google | **direct** | google.com, googleapis.com, gstatic.com | — | — |
| Microsoft | **direct** | microsoft.com, live.com, msn.com | — | — |
| Apple | **direct** | apple.com, icloud.com | — | — |
| Amazon | **direct** | amazon.com, amazonaws.com | — | — |

### How routing rules are assembled

All domain suffix and keyword rules for the same routing target are merged into ONE `domain` array in xray format:

```
proxy_domains = all DOMAIN-SUFFIX values (bare) + all DOMAIN-KEYWORD values (prefixed with "keyword:") from all proxy-routed apps
proxy_ips     = all IP-CIDR and IP-CIDR6 values from all proxy-routed apps
direct_domains = all DOMAIN-SUFFIX + keyword values from all direct-routed apps
```

This produces two rules for proxy traffic (one domain rule, one IP rule), and up to two rules for direct traffic. No separate domain_keyword rule objects needed — xray's `domain` field handles both suffix and keyword in one array.

---

## 12. Advanced Settings Reference

Defaults:

| Setting | Variable | Default | Effect |
|---|---|---|---|
| Auto Switch interval | `autoSwitchInterval` | `900` | `observatory.probeInterval` in seconds |
| Check interval | `checkInterval` | `120` | Reserved (currently probeInterval uses autoSwitchInterval) |
| Subscription update interval | `updateInterval` | `24` | Used in V2Box plain-text format only, not in JSON |
| Global default | `globalDefault` | `"Proxy"` | Final catch-all rule: `balancerTag` (proxy) or `outboundTag: "direct"` |
| Load Balance | `loadBalance` | `false` | Balancer strategy: `leastping` (default) or `roundRobin` (when true) |

---

## 13. Anti-DPI Mode

When `antiDPI = true`, the config is significantly different.

> **Format note:** The JSON generator produces **xray/V2Ray** format. All anti-DPI fields described here use xray field names. The fields you see in V2Box's node editor ("Utls", "ALPN", "allow insecure", "Fragment", "Head Type") map directly to xray `streamSettings` fields that this generator now properly sets on every node.

### 13.1 Per-Node Changes (attached to every TLS outbound)

When `antiDPI = true`, a `utls` block is added inside the `tls` object of **every TLS-using outbound**: VMess (if TLS), VLESS, Trojan, Hysteria2.

```json
"tls": {
  "enabled": true,
  "insecure": true,
  "server_name": "<domain>",
  "utls": { "enabled": true, "fingerprint": "<clientFingerprint>" }
}
```

Default `clientFingerprint` is `"random"`. Other options: `"chrome"`, `"firefox"`, `"safari"`, `"ios"`, `"android"`, `"edge"`, `"360"`, `"qq"`.

**Protocol-specific uTLS examples:**

VMess + TLS + anti-DPI:
```json
{
  "type": "vmess",
  "tag": "🇸🇬 VChannel-Premium (Unlimited) SG01",
  "server": "pul01.vchannel.dpdns.org",
  "server_port": 443,
  "uuid": "...",
  "alter_id": 0,
  "security": "auto",
  "tls": { "enabled": true, "insecure": true, "server_name": "pul01.vchannel.dpdns.org",
           "utls": { "enabled": true, "fingerprint": "random" } }
}
```

VLESS + anti-DPI:
```json
{
  "type": "vless",
  "tag": "🇸🇬 VChannel-Premium (Unlimited) SG01",
  "server": "pul01.vchannel.dpdns.org",
  "server_port": 443,
  "uuid": "...",
  "tls": { "enabled": true, "insecure": true, "server_name": "pul01.vchannel.dpdns.org",
           "utls": { "enabled": true, "fingerprint": "random" } }
}
```

Trojan + anti-DPI:
```json
{
  "type": "trojan",
  "tag": "🇸🇬 VChannel-Premium (Unlimited) SG01",
  "server": "pul01.vchannel.dpdns.org",
  "server_port": 443,
  "password": "...",
  "tls": { "enabled": true, "insecure": true, "server_name": "pul01.vchannel.dpdns.org",
           "utls": { "enabled": true, "fingerprint": "random" } }
}
```

Hysteria2 + anti-DPI:
```json
{
  "type": "hysteria2",
  "tag": "🇸🇬 VChannel-Premium (Unlimited) SG01",
  "server": "pul01.vchannel.dpdns.org",
  "server_port": 443,
  "password": "...",
  "tls": { "enabled": true, "insecure": true, "server_name": "pul01.vchannel.dpdns.org",
           "utls": { "enabled": true, "fingerprint": "random" } }
}
```

**Shadowsocks + anti-DPI:** Shadowsocks uses plain TCP/UDP with no TLS, so `utls` does **not** apply to SS nodes. Their anti-DPI benefit comes only from the global `tls_fragment` and `dial_fields` settings below.

### 13.2 Global Config Changes (top-level additions)

These fields are **not per-node** — they apply to the entire sing-box instance.

> **V2Box note:** When you open an individual node in V2Box's per-node editor, you will see fields like "Fragment: off" and "Utls: Not Set". This is V2Box's per-node view and does NOT mean the global sing-box settings are absent. The global `tls_fragment` and `dial_fields` in the JSON config do apply to all outbounds. The per-node "Fragment" toggle in V2Box is a V2Box-specific UI concept that is separate from the sing-box global setting.

#### TCP Concurrent

If `tcpConcurrent = true` (default when anti-DPI is on):
```json
"dial_fields": { "tcp_multi_path": true, "tcp_fast_open": true }
```
This is added at the **root** of the config object (same level as `log`, `dns`, `inbounds`, etc.).

#### TLS Fragment

If `tlsFragment = true`:
```json
"tls_fragment": {
  "enabled": true,
  "size": "<fragmentLength>",
  "sleep": "<fragmentInterval>"
}
```
Also added at the **root** of the config object.
Defaults: size `"10-30"`, sleep `"10-20"`.

### 13.3 DNS section changes

A full DoH (DNS over HTTPS) setup replaces the simple local DNS:

```json
"dns": {
  "servers": [
    {
      "tag": "remote-doh",
      "address": "<dohServer>",
      "address_resolver": "local-dns",
      "detour": "proxy"
    },
    { "tag": "cf-doh",     "address": "https://1.1.1.1/dns-query",       "address_resolver": "local-dns", "detour": "proxy" },
    { "tag": "google-doh", "address": "https://dns.google/dns-query",     "address_resolver": "local-dns", "detour": "proxy" },
    { "tag": "local-dns",  "address": "local",                            "detour": "direct" }
  ],
  "rules": [
    { "outbound": "any", "server": "local-dns" }
  ],
  "final": "remote-doh",
  "independent_cache": true
}
```

Note: cf-doh and google-doh are only added if they differ from the selected `dohServer`.

### 13.4 Fake DNS (optional)

If `fakeDNS = true`:
- Adds `{ "tag": "fakeip", "address": "fakeip" }` to DNS servers
- Adds FakeIP query rule: `{ "query_type": ["A", "AAAA"], "server": "fakeip", "rewrite_ttl": 1 }`
- Adds FakeIP range to DNS config: `{ "enabled": true, "inet4_range": "198.18.0.0/15", "inet6_range": "fc00::/18" }`
- Sets `experimental.cache_file.store_fakeip = true`

### 13.5 SS Prefix (optional)

When `ssPrefix = true` and a `ssPrefixValue` is set:

- Shadowsocks subscription URIs use `/?outline=1&prefix=<value>`
  - With prefix:    `ss://{userinfo}@{server}:{port}/?outline=1&prefix=%16%03%01…#{Name}`
  - Without prefix: `ss://{userinfo}@{server}:{port}#{Name}` (no query string)
- A `_prefix` metadata field is added to the Shadowsocks outbound in the sing-box JSON. This is **not** a standard sing-box field — it is read by the key server when generating subscription URIs on-the-fly via `/sub/{token}`.
- The sing-box config itself does NOT use a plugin or obfs for the prefix; it is purely a URI-level annotation for clients that support it (e.g. Outline).

### 13.6 Anti-DPI Setting Summary Table

| Setting | Where applied | V2Box per-node view |
|---|---|---|
| `utls` fingerprint | Per-node, inside `tls` block (VMess/VLESS/Trojan/Hysteria2) | Shows as "Utls: {fingerprint}" when set |
| `tls_fragment` | Global config root | Shows as "Fragment: off" (V2Box reads its own per-node field, not global) |
| `dial_fields` | Global config root | Not visible in V2Box per-node editor |
| DoH DNS | Global DNS section | Not visible in per-node editor |
| Shadowsocks | No per-node TLS change | "Utls: Not Set" is correct — SS has no TLS |

---

## 14. Load Balance Mode

When `loadBalance = true`, a 4th urltest group is added.

### Selector outbounds with load balance

```json
"outbounds": ["♻️ Auto Switch", "⚡ Fastest", "🛡️ Failover", "⚖️ Load Balance", ...nodeTags, "direct"]
```

If `staticBalance = true`, the tag is `"⚖️ Balanced"` instead.

### 4th urltest group

```json
{
  "type": "urltest",
  "tag": "⚖️ Load Balance",
  "outbounds": [...nodeTags],
  "url": "http://www.gstatic.com/generate_204",
  "interval": "<checkInterval>s",
  "tolerance": 100,
  "idle_timeout": "30m"
}
```

The `idle_timeout` field is what makes it behave more like load balancing — sessions spread across nodes after they've been idle.

---

## 15. Uploading to Key Server

### 15.1 Building the Request

```http
POST /api/keyserver/keys
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "filename": "vchannel-config-username.json",
  "content": "<full json string>",
  "metadata": {
    "expire_date": "2026-12-31",
    "data_limit_gb": 150
  }
}
```

**Filename convention:** `{filePrefix}-{fileSuffix}.json`
- `filePrefix` default: `vchannel-config` (user-configurable, stored in `localStorage`)
- `fileSuffix` is auto-derived from `account_name`: lowercase, spaces and underscores removed

Example: account_name `"Ko Yan"` → fileSuffix `"koyan"` → filename `"vchannel-config-koyan.json"`

**Metadata fields (all optional):**
- `expire_date` — ISO date `"YYYY-MM-DD"` — when the subscription expires
- `data_limit_gb` — number — data cap in GB (omit or null if unlimited)
- `unlimited` — `true` — include if user has unlimited plan

### 15.2 Getting the Subscription URLs

After upload, use the returned `token` from the JSON file and the key server config. **Three URLs** are generated — all from the same `.json` file token:

```python
ks_config     = GET /api/keyserver/config
token         = upload_response["token"]    # from POST /api/keyserver/keys response

public_domain = ks_config["publicDomain"]   # e.g. "key.example.com" or ""
port          = ks_config["port"]            # e.g. 8088
secret_key    = ks_config["secretKey"]       # required query param

if public_domain:
    if not public_domain.startswith("http"):
        base = f"http://{public_domain}"
    else:
        base = public_domain.rstrip("/")
else:
    base = f"http://<SERVER_IP>:{port}"

base_url  = f"{base}/sub/{token}?key={secret_key}"
sub_url   = base_url                        # Base64 proxy URI list
raw_url   = f"{base_url}&format=raw"        # proxy-only sing-box JSON
v2ray_url = f"{base_url}&format=v2ray"      # full V2Ray/Xray JSON config
```

| URL | `&format=` | Response format | Compatible clients |
|---|---|---|---|
| `sub_url` | _(none)_ | Base64-encoded proxy URI list | V2Box, V2RayNG, any standard subscription client |
| `raw_url` | `raw` | `{"outbounds":[proxy nodes only]}` (sing-box) | V2Box, NekoBox sing-box subscription |
| `v2ray_url` | `v2ray` | Full V2Ray/Xray JSON config | V2RayNG local config import, Xray clients |

> ⚠️ The token goes in the **URL path** (`/sub/<token>`), NOT as a query parameter. The `?key=` is the **server's shared secret** — not the token.

> **Note:** The `?format=raw` endpoint returns only the proxy outbounds (`shadowsocks`, `vmess`, `vless`, `trojan`, `hysteria2` types) — all selector/urltest/dns/direct/block outbounds are stripped. The response shape is `{"outbounds": [...]}`, not the full sing-box config.

---

## 16. Complete Python Reference Implementation

```python
"""
JSON Generator Bot - Reference Implementation
Replicates the exact output of JsonGeneratorPage.jsx generateJSON()
"""

import json
import base64
import re
from urllib.parse import urlparse, parse_qs, unquote
import requests

# ─── Configuration ───────────────────────────────────────────────────

BACKEND         = "http://your-server:3001"
ADMIN_JWT       = "your-admin-jwt-token"
GROUP_NAME      = "VChannel-Premium"
FILE_PREFIX     = "vchannel-config"

HEADERS = {
    "Authorization": f"Bearer {ADMIN_JWT}",
    "Content-Type": "application/json"
}

FLAG_MAP = {
    "SG": "🇸🇬", "HK": "🇭🇰", "US": "🇺🇸", "JP": "🇯🇵",
    "ID": "🇮🇩", "TH": "🇹🇭", "VN": "🇻🇳", "UK": "🇬🇧",
    "CN": "🇨🇳", "IN": "🇮🇳", "AU": "🇦🇺"
}

# Default app routing (matches generateJSON defaults)
DEFAULT_APP_ROUTING = {
    "Netflix":   "proxy", "YouTube":   "proxy",
    "Facebook":  "proxy", "Instagram": "proxy",
    "Messenger": "proxy", "Threads":   "proxy",
    "Twitter":   "proxy", "TikTok":    "proxy",
    "WhatsApp":  "proxy", "Telegram":  "proxy",
    "Signal":    "proxy", "Discord":   "proxy",
    "Spotify":   "proxy", "ChatGPT":   "proxy",
    "GitHub":    "proxy",
    "Google":    "direct", "Microsoft": "direct",
    "Apple":     "direct", "Amazon":    "direct",
}

APP_DOMAINS = {
    "Netflix":   [("DOMAIN-SUFFIX", "netflix.com"), ("DOMAIN-SUFFIX", "nflxvideo.net"),
                  ("DOMAIN-SUFFIX", "nflximg.net"),  ("DOMAIN-SUFFIX", "nflxext.com"),
                  ("DOMAIN-SUFFIX", "nflxso.net")],
    "YouTube":   [("DOMAIN-SUFFIX", "youtube.com"),         ("DOMAIN-SUFFIX", "googlevideo.com"),
                  ("DOMAIN-SUFFIX", "ytimg.com"),            ("DOMAIN-SUFFIX", "yt.be"),
                  ("DOMAIN-SUFFIX", "youtu.be"),             ("DOMAIN-SUFFIX", "youtube-nocookie.com"),
                  ("DOMAIN-SUFFIX", "yt3.ggpht.com")],
    "Facebook":  [("DOMAIN-SUFFIX", "facebook.com"),        ("DOMAIN-SUFFIX", "fbcdn.net"),
                  ("DOMAIN-SUFFIX", "fb.com"),               ("DOMAIN-SUFFIX", "fb.me"),
                  ("DOMAIN-SUFFIX", "fbsbx.com"),            ("DOMAIN-SUFFIX", "fbpigeon.com"),
                  ("DOMAIN-SUFFIX", "fb.gg"),                ("DOMAIN-SUFFIX", "facebook.net"),
                  ("DOMAIN-SUFFIX", "facebookcorewwwi.onion"), ("DOMAIN-SUFFIX", "accountkit.com"),
                  ("DOMAIN-SUFFIX", "freebasics.com"),
                  ("DOMAIN-KEYWORD", "facebook"),             ("DOMAIN-KEYWORD", "fbcdn"),
                  ("IP-CIDR", "31.13.24.0/21"),  ("IP-CIDR", "31.13.64.0/18"),
                  ("IP-CIDR", "45.64.40.0/22"),  ("IP-CIDR", "66.220.144.0/20"),
                  ("IP-CIDR", "69.63.176.0/20"),  ("IP-CIDR", "69.171.224.0/19"),
                  ("IP-CIDR", "74.119.76.0/22"),  ("IP-CIDR", "102.132.96.0/20"),
                  ("IP-CIDR", "103.4.96.0/22"),   ("IP-CIDR", "129.134.0.0/17"),
                  ("IP-CIDR", "157.240.0.0/17"),  ("IP-CIDR", "173.252.64.0/18"),
                  ("IP-CIDR", "179.60.192.0/22"), ("IP-CIDR", "185.60.216.0/22"),
                  ("IP-CIDR", "185.89.218.0/23"), ("IP-CIDR", "204.15.20.0/22"),
                  ("IP-CIDR", "2620:0:1c00::/40"), ("IP-CIDR", "2a03:2880::/32")],
    "Instagram": [("DOMAIN-SUFFIX", "instagram.com"), ("DOMAIN-SUFFIX", "cdninstagram.com"),
                  ("DOMAIN-SUFFIX", "ig.me"),          ("DOMAIN-SUFFIX", "instagram.net"),
                  ("DOMAIN-KEYWORD", "instagram")],
    "Messenger": [("DOMAIN-SUFFIX", "messenger.com"), ("DOMAIN-SUFFIX", "m.me"),
                  ("DOMAIN-SUFFIX", "msngr.com"),      ("DOMAIN-KEYWORD", "messenger"),
                  ("IP-CIDR", "69.171.250.0/24"),      ("IP-CIDR", "31.13.86.0/24")],
    "Threads":   [("DOMAIN-SUFFIX", "threads.net"), ("DOMAIN-SUFFIX", "threads.com"),
                  ("DOMAIN-KEYWORD", "threads")],
    "Twitter":   [("DOMAIN-SUFFIX", "twitter.com"),      ("DOMAIN-SUFFIX", "twimg.com"),
                  ("DOMAIN-SUFFIX", "x.com"),             ("DOMAIN-SUFFIX", "t.co"),
                  ("DOMAIN-SUFFIX", "twittercdn.com"),    ("DOMAIN-SUFFIX", "twitterstat.us"),
                  ("DOMAIN-SUFFIX", "twttr.com"),         ("DOMAIN-KEYWORD", "twitter")],
    "TikTok":    [("DOMAIN-SUFFIX", "tiktok.com"),      ("DOMAIN-SUFFIX", "tiktokcdn.com"),
                  ("DOMAIN-SUFFIX", "tiktokv.com"),      ("DOMAIN-SUFFIX", "tiktokcdn-us.com"),
                  ("DOMAIN-SUFFIX", "musical.ly"),       ("DOMAIN-KEYWORD", "tiktok")],
    "WhatsApp":  [("DOMAIN-SUFFIX", "whatsapp.com"),    ("DOMAIN-SUFFIX", "whatsapp.net"),
                  ("DOMAIN-SUFFIX", "wa.me"),            ("DOMAIN-KEYWORD", "whatsapp"),
                  ("IP-CIDR", "18.194.0.0/15"),          ("IP-CIDR", "34.224.0.0/12"),
                  ("IP-CIDR", "50.19.0.0/16"),           ("IP-CIDR", "52.0.0.0/11")],
    "Telegram":  [("DOMAIN-SUFFIX", "telegram.org"),  ("DOMAIN-SUFFIX", "t.me"),
                  ("DOMAIN-SUFFIX", "telegra.ph"),     ("DOMAIN-SUFFIX", "telegram.me"),
                  ("DOMAIN-SUFFIX", "telegram.dog"),   ("DOMAIN-SUFFIX", "telesco.pe"),
                  ("IP-CIDR", "91.108.4.0/22"),        ("IP-CIDR", "91.108.8.0/21"),
                  ("IP-CIDR", "91.108.16.0/21"),       ("IP-CIDR", "91.108.56.0/22"),
                  ("IP-CIDR", "95.161.64.0/20"),       ("IP-CIDR", "149.154.160.0/20"),
                  ("IP-CIDR", "2001:67c:4e8::/48"),    ("IP-CIDR", "2001:b28:f23d::/48")],
    "Signal":    [("DOMAIN-SUFFIX", "signal.org"),          ("DOMAIN-SUFFIX", "whispersystems.org"),
                  ("DOMAIN-SUFFIX", "signal.art"),
                  ("IP-CIDR", "13.248.212.0/24"),            ("IP-CIDR", "76.223.92.0/24")],
    "Discord":   [("DOMAIN-SUFFIX", "discord.com"),      ("DOMAIN-SUFFIX", "discordapp.com"),
                  ("DOMAIN-SUFFIX", "discordapp.net"),    ("DOMAIN-SUFFIX", "discord.gg"),
                  ("DOMAIN-SUFFIX", "discord.media"),     ("DOMAIN-KEYWORD", "discord")],
    "Spotify":   [("DOMAIN-SUFFIX", "spotify.com"),  ("DOMAIN-SUFFIX", "scdn.co"),
                  ("DOMAIN-SUFFIX", "spotify.design"), ("DOMAIN-SUFFIX", "spotifycdn.com")],
    "ChatGPT":   [("DOMAIN-SUFFIX", "openai.com"),       ("DOMAIN-SUFFIX", "chatgpt.com"),
                  ("DOMAIN-SUFFIX", "oaistatic.com"),    ("DOMAIN-SUFFIX", "oaiusercontent.com")],
    "GitHub":    [("DOMAIN-SUFFIX", "github.com"),        ("DOMAIN-SUFFIX", "githubusercontent.com"),
                  ("DOMAIN-SUFFIX", "github.io"),          ("DOMAIN-SUFFIX", "githubassets.com")],
    "Google":    [("DOMAIN-SUFFIX", "google.com"),     ("DOMAIN-SUFFIX", "googleapis.com"),
                  ("DOMAIN-SUFFIX", "gstatic.com")],
    "Microsoft": [("DOMAIN-SUFFIX", "microsoft.com"), ("DOMAIN-SUFFIX", "live.com"),
                  ("DOMAIN-SUFFIX", "msn.com")],
    "Apple":     [("DOMAIN-SUFFIX", "apple.com"), ("DOMAIN-SUFFIX", "icloud.com")],
    "Amazon":    [("DOMAIN-SUFFIX", "amazon.com"), ("DOMAIN-SUFFIX", "amazonaws.com")],
}


# ─── URI Parsers ─────────────────────────────────────────────────────

def parse_ss_uri(uri):
    """Parse ss://BASE64(cipher:password)@host:port#name"""
    url = urlparse(uri)
    userinfo = base64.b64decode(url.username + "==").decode("utf-8", errors="replace")
    cipher, password = userinfo.split(":", 1)
    return {
        "type": "ss",
        "server": url.hostname,   # will be replaced
        "port": url.port,
        "cipher": cipher,
        "password": password,
        "udp": True
    }


def parse_vmess_uri(uri):
    """Parse vmess://BASE64(JSON)"""
    data = base64.b64decode(uri[8:] + "==").decode("utf-8", errors="replace")
    j = json.loads(data)
    node = {
        "type": "vmess",
        "server": j["add"],
        "port": int(j["port"]),
        "uuid": j["id"],
        "alterId": int(j.get("aid", 0)),
        "cipher": j.get("scy", "auto"),
        "udp": True,
        "skip-cert-verify": True
    }
    if j.get("net"):
        node["network"] = j["net"]
    if j.get("tls") == "tls":
        node["tls"] = True
    if j.get("host"):
        node["servername"] = j["host"]
    if j.get("net") == "ws":
        node["ws-opts"] = {
            "path": j.get("path", "/"),
            "headers": {"Host": j.get("host", j["add"])}
        }
    return node


def parse_vless_uri(uri):
    """Parse vless://uuid@host:port?params#name"""
    url = urlparse(uri)
    params = dict(p.split("=", 1) for p in url.query.split("&") if "=" in p)
    node = {
        "type": "vless",
        "server": url.hostname,
        "port": url.port,
        "uuid": url.username,
        "udp": True,
        "skip-cert-verify": True,
        "client-fingerprint": params.get("fp", "chrome")
    }
    network = params.get("type") or params.get("network")
    if network:
        node["network"] = network
    if params.get("security") == "tls":
        node["tls"] = True
        if params.get("sni"):
            node["servername"] = params["sni"]
    if network == "ws":
        node["udp"] = False
        node["ws-opts"] = {
            "path": params.get("path", "/"),
            "headers": {"Host": params.get("host", url.hostname)}
        }
        flow = params.get("flow", "")
        if flow.strip():
            node["flow"] = flow
    return node


def parse_trojan_uri(uri):
    """Parse trojan://password@host:port?params#name"""
    url = urlparse(uri)
    params = dict(p.split("=", 1) for p in url.query.split("&") if "=" in p)
    node = {
        "type": "trojan",
        "server": url.hostname,
        "port": url.port,
        "password": unquote(url.username),
        "udp": True,
        "skip-cert-verify": True
    }
    if params.get("sni"):
        node["sni"] = params["sni"]
    if params.get("type"):
        node["network"] = params["type"]
    if node.get("network") == "ws":
        node["ws-opts"] = {
            "path": params.get("path", "/"),
            "headers": {"Host": params.get("host", url.hostname)}
        }
    return node


def parse_hy2_uri(uri):
    """Parse hy2://password@host:port?sni=...#name"""
    uri = uri.replace("hy2://", "hysteria2://")
    url = urlparse(uri)
    params = dict(p.split("=", 1) for p in url.query.split("&") if "=" in p)
    return {
        "type": "hysteria2",
        "server": url.hostname,
        "port": url.port,
        "password": unquote(url.username),
        "udp": True,
        "skip-cert-verify": True,
        "sni": params.get("sni", url.hostname)
    }


def parse_proxy_uri(uri):
    uri = uri.strip()
    if uri.startswith("ss://"):         return parse_ss_uri(uri)
    if uri.startswith("vmess://"):      return parse_vmess_uri(uri)
    if uri.startswith("vless://"):      return parse_vless_uri(uri)
    if uri.startswith("trojan://"):     return parse_trojan_uri(uri)
    if uri.startswith(("hy2://", "hysteria2://")): return parse_hy2_uri(uri)
    raise ValueError(f"Unsupported URI scheme: {uri[:20]}")


# ─── Node Name Builder ────────────────────────────────────────────────

def build_node_name(group_name, domain_entry):
    code = domain_entry["server"][:2].upper()
    flag = FLAG_MAP.get(code, "")
    unlim_label = " (Unlimited)" if domain_entry.get("unlimited") else ""
    name = f"{flag} {group_name}{unlim_label} {domain_entry['server']}"
    return name.strip()


# ─── Domain Override ──────────────────────────────────────────────────

def apply_domain_override(node, domain_entry):
    """Replace server address and TLS fields with the domain entry's values."""
    domain = domain_entry["domain"]
    node = dict(node)
    node["server"] = domain
    if "servername" in node:
        node["servername"] = domain
    if "sni" in node:
        node["sni"] = domain
    if "ws-opts" in node and "headers" in node["ws-opts"]:
        if "Host" in node["ws-opts"]["headers"]:
            node["ws-opts"] = dict(node["ws-opts"])
            node["ws-opts"]["headers"] = dict(node["ws-opts"]["headers"])
            node["ws-opts"]["headers"]["Host"] = domain
    return node


# ─── Deduplication ────────────────────────────────────────────────────

def deduplicate_names(nodes):
    """Append A, B, C... to duplicate node names."""
    from collections import Counter
    counts = Counter(n["name"] for n in nodes)
    indices = {}
    result = []
    for node in nodes:
        name = node["name"]
        if counts[name] > 1:
            idx = indices.get(name, 0)
            indices[name] = idx + 1
            node = dict(node)
            node["name"] = f"{name} {chr(65 + idx)}"
        result.append(node)
    return result


# ─── sing-box Conversion ──────────────────────────────────────────────

def build_tls(node, anti_dpi=False, client_fingerprint="random"):
    has_tls = (
        node.get("tls") or
        node["type"] in ("trojan", "hysteria2") or
        (node["type"] == "vless")
    )
    if not has_tls:
        return None
    tls = {
        "enabled": True,
        "insecure": node.get("skip-cert-verify", True) is not False
    }
    sni = (node.get("servername") or node.get("sni") or
           node.get("ws-opts", {}).get("headers", {}).get("Host") or node["server"])
    if sni:
        tls["server_name"] = sni
    if node.get("alpn"):
        alpn = node["alpn"]
        tls["alpn"] = alpn if isinstance(alpn, list) else [alpn]
    if anti_dpi or node.get("client-fingerprint"):
        fp = client_fingerprint if anti_dpi else node["client-fingerprint"]
        tls["utls"] = {"enabled": True, "fingerprint": fp}
    return tls


def build_transport(node):
    net = node.get("network")
    if not net or net == "tcp":
        return None
    if net == "ws":
        t = {"type": "ws"}
        ws = node.get("ws-opts", {})
        if ws.get("path"):
            t["path"] = ws["path"]
        if ws.get("headers"):
            t["headers"] = ws["headers"]
        return t
    if net == "grpc":
        return {"type": "grpc", "service_name": node.get("grpc-opts", {}).get("grpc-service-name", "")}
    if net == "h2":
        t = {"type": "http"}
        h2 = node.get("h2-opts", {})
        if h2.get("path"):
            t["path"] = h2["path"]
        if h2.get("host"):
            t["host"] = h2["host"]
        return t
    return None


def convert_node_to_singbox(node, anti_dpi=False, client_fingerprint="random"):
    base = {"server": node["server"], "server_port": node["port"]}

    if node["type"] == "ss":
        out = {**base, "type": "shadowsocks", "tag": node["name"],
               "method": node["cipher"], "password": node["password"]}
        tls = build_tls(node, anti_dpi, client_fingerprint)
        if tls:
            out["tls"] = tls
        return out

    if node["type"] == "vmess":
        out = {**base, "type": "vmess", "tag": node["name"],
               "uuid": node["uuid"], "alter_id": node.get("alterId", 0),
               "security": node.get("cipher", "auto")}
        tls = build_tls(node, anti_dpi, client_fingerprint)
        if tls:
            out["tls"] = tls
        t = build_transport(node)
        if t:
            out["transport"] = t
        return out

    if node["type"] == "vless":
        out = {**base, "type": "vless", "tag": node["name"], "uuid": node["uuid"]}
        flow = node.get("flow", "").strip()
        if flow:
            out["flow"] = flow
        tls = build_tls(node, anti_dpi, client_fingerprint)
        if tls:
            out["tls"] = tls
        else:
            out["tls"] = {"enabled": True, "insecure": True, "server_name": node["server"]}
            if anti_dpi:
                out["tls"]["utls"] = {"enabled": True, "fingerprint": client_fingerprint}
        t = build_transport(node)
        if t:
            out["transport"] = t
        return out

    if node["type"] == "trojan":
        out = {**base, "type": "trojan", "tag": node["name"], "password": node["password"]}
        tls = build_tls(node, anti_dpi, client_fingerprint)
        if tls:
            out["tls"] = tls
        else:
            out["tls"] = {"enabled": True, "insecure": True,
                          "server_name": node.get("sni") or node["server"]}
            if anti_dpi:
                out["tls"]["utls"] = {"enabled": True, "fingerprint": client_fingerprint}
        t = build_transport(node)
        if t:
            out["transport"] = t
        return out

    if node["type"] == "hysteria2":
        out = {**base, "type": "hysteria2", "tag": node["name"], "password": node["password"],
               "tls": {"enabled": True, "insecure": node.get("skip-cert-verify", True) is not False,
                       "server_name": node.get("sni") or node["server"]}}
        if node.get("alpn"):
            alpn = node["alpn"]
            out["tls"]["alpn"] = alpn if isinstance(alpn, list) else [alpn]
        return out

    # Fallback
    return {**base, "type": node["type"], "tag": node["name"]}


# ─── Routing Builder ─────────────────────────────────────────────────

def build_routing_rules(app_routing=None):
    if app_routing is None:
        app_routing = DEFAULT_APP_ROUTING

    proxy_suffix, proxy_keyword, proxy_cidr = [], [], []
    direct_suffix, direct_keyword, direct_cidr = [], [], []

    for app, target in app_routing.items():
        rules = APP_DOMAINS.get(app, [])
        for rule_type, value in rules:
            if target == "proxy":
                if rule_type == "DOMAIN-SUFFIX":     proxy_suffix.append(value)
                elif rule_type == "DOMAIN-KEYWORD":  proxy_keyword.append(value)
                elif rule_type in ("IP-CIDR", "IP-CIDR6"): proxy_cidr.append(value)
            else:
                if rule_type == "DOMAIN-SUFFIX":     direct_suffix.append(value)
                elif rule_type == "DOMAIN-KEYWORD":  direct_keyword.append(value)
                elif rule_type in ("IP-CIDR", "IP-CIDR6"): direct_cidr.append(value)

    rules = [
        {"protocol": "dns", "outbound": "dns-out"},
        {"ip_is_private": True, "outbound": "direct"},
    ]
    if proxy_suffix:  rules.append({"domain_suffix":  proxy_suffix,  "outbound": "proxy"})
    if proxy_keyword: rules.append({"domain_keyword": proxy_keyword, "outbound": "proxy"})
    if proxy_cidr:    rules.append({"ip_cidr":        proxy_cidr,    "outbound": "proxy"})
    if direct_suffix: rules.append({"domain_suffix":  direct_suffix, "outbound": "direct"})
    if direct_keyword:rules.append({"domain_keyword": direct_keyword,"outbound": "direct"})
    if direct_cidr:   rules.append({"ip_cidr":        direct_cidr,   "outbound": "direct"})
    return rules


# ─── Config Builder ───────────────────────────────────────────────────

def build_config(node_outbounds, opts=None):
    """
    opts keys (all optional):
      auto_switch_interval  int     default 900
      check_interval        int     default 120
      global_default        str     "Proxy" or "Direct", default "Proxy"
      load_balance          bool    default False
      static_balance        bool    default False
      anti_dpi              bool    default False
      doh_server            str     default "https://1.1.1.1/dns-query"
      fake_dns              bool    default False
      tcp_concurrent        bool    default True (only when anti_dpi)
      tls_fragment          bool    default False
      fragment_length       str     default "10-30"
      fragment_interval     str     default "10-20"
      app_routing           dict    default DEFAULT_APP_ROUTING
    """
    opts = opts or {}
    auto_switch_interval = opts.get("auto_switch_interval", 900)
    check_interval       = opts.get("check_interval", 120)
    global_default       = opts.get("global_default", "Proxy")
    load_balance         = opts.get("load_balance", False)
    static_balance       = opts.get("static_balance", False)
    anti_dpi             = opts.get("anti_dpi", False)
    doh_server           = opts.get("doh_server", "https://1.1.1.1/dns-query")
    fake_dns             = opts.get("fake_dns", False)
    tcp_concurrent       = opts.get("tcp_concurrent", True)
    tls_fragment         = opts.get("tls_fragment", False)
    fragment_length      = opts.get("fragment_length", "10-30")
    fragment_interval    = opts.get("fragment_interval", "10-20")
    app_routing          = opts.get("app_routing", DEFAULT_APP_ROUTING)

    node_tags = [n["tag"] for n in node_outbounds]
    config = {"log": {"level": "info"}}

    # DNS
    if anti_dpi:
        dns_servers = [
            {"tag": "remote-doh", "address": doh_server,
             "address_resolver": "local-dns", "detour": "proxy"}
        ]
        if doh_server != "https://1.1.1.1/dns-query":
            dns_servers.append({"tag": "cf-doh", "address": "https://1.1.1.1/dns-query",
                                 "address_resolver": "local-dns", "detour": "proxy"})
        if doh_server != "https://dns.google/dns-query":
            dns_servers.append({"tag": "google-doh", "address": "https://dns.google/dns-query",
                                 "address_resolver": "local-dns", "detour": "proxy"})
        dns_servers.append({"tag": "local-dns", "address": "local", "detour": "direct"})
        dns_rules = [{"outbound": "any", "server": "local-dns"}]
        dns = {"servers": dns_servers, "rules": dns_rules,
               "final": "remote-doh", "independent_cache": True}
        if fake_dns:
            dns_servers.append({"tag": "fakeip", "address": "fakeip"})
            dns_rules.append({"query_type": ["A", "AAAA"], "server": "fakeip", "rewrite_ttl": 1})
            dns["fakeip"] = {"enabled": True, "inet4_range": "198.18.0.0/15",
                              "inet6_range": "fc00::/18"}
        config["dns"] = dns
    else:
        config["dns"] = {
            "servers": [{"tag": "default-dns", "address": "local"}],
            "final": "default-dns"
        }

    # Inbounds
    tun = {
        "type": "tun", "tag": "tun-in",
        "inet4_address": "172.19.0.1/30",
        "inet6_address": "fdfe:dcba:9876::1/126",
        "auto_route": True, "strict_route": True,
        "stack": "mixed", "sniff": True,
        "auto_redirect_output_mark": 8872
    }
    config["inbounds"] = [
        tun,
        {"type": "mixed", "tag": "mixed-in", "listen": "::", "listen_port": 7890, "sniff": True}
    ]

    # Outbounds
    lb_tag = "⚖️ Balanced" if static_balance else "⚖️ Load Balance"
    selector_outbounds = ["♻️ Auto Switch", "⚡ Fastest", "🛡️ Failover"]
    if load_balance:
        selector_outbounds.append(lb_tag)
    selector_outbounds += node_tags + ["direct"]

    outbounds = [
        {"type": "selector", "tag": "proxy", "outbounds": selector_outbounds,
         "default": "♻️ Auto Switch"},
        {"type": "urltest", "tag": "♻️ Auto Switch", "outbounds": list(node_tags),
         "url": "http://www.gstatic.com/generate_204",
         "interval": f"{auto_switch_interval}s", "tolerance": 150},
        {"type": "urltest", "tag": "⚡ Fastest", "outbounds": list(node_tags),
         "url": "http://www.gstatic.com/generate_204",
         "interval": f"{check_interval}s", "tolerance": 50},
        {"type": "urltest", "tag": "🛡️ Failover", "outbounds": list(node_tags),
         "url": "http://www.gstatic.com/generate_204",
         "interval": f"{check_interval}s", "tolerance": 300},
    ]
    if load_balance:
        outbounds.append({
            "type": "urltest", "tag": lb_tag, "outbounds": list(node_tags),
            "url": "http://www.gstatic.com/generate_204",
            "interval": f"{check_interval}s", "tolerance": 100,
            "idle_timeout": "30m"
        })
    outbounds += list(node_outbounds)
    outbounds += [
        {"type": "direct", "tag": "direct"},
        {"type": "dns",    "tag": "dns-out"},
        {"type": "block",  "tag": "block"}
    ]
    config["outbounds"] = outbounds

    # Route
    route_final = "proxy" if global_default == "Proxy" else "direct"
    config["route"] = {
        "rules": build_routing_rules(app_routing),
        "final": route_final,
        "auto_detect_interface": True,
        "final_ipv6": True
    }

    # Anti-DPI extras
    if anti_dpi and tcp_concurrent:
        config["dial_fields"] = {"tcp_multi_path": True, "tcp_fast_open": True}
    if anti_dpi and tls_fragment:
        config["tls_fragment"] = {
            "enabled": True, "size": fragment_length, "sleep": fragment_interval
        }

    # Experimental
    config["experimental"] = {
        "clash_api": {"external_controller": "127.0.0.1:9090"},
        "cache_file": {"enabled": True, "store_fakeip": bool(anti_dpi and fake_dns)}
    }

    return config


# ─── Main Bot Function ────────────────────────────────────────────────

def generate_and_upload(proxy_uris, domain_entries, user, opts=None):
    """
    proxy_uris     — list of proxy URI strings (ss://, vmess://, etc.)
    domain_entries — list of domain objects from GET /api/domains (same order)
    user           — user object from GET /api/users/search
    opts           — optional settings dict (see build_config docstring)
    """
    group_name = GROUP_NAME
    unlim = "unlimited" in user.get("service_type", "").lower()

    # 1. Parse, override, name
    nodes = []
    for uri, domain_entry in zip(proxy_uris, domain_entries):
        node = parse_proxy_uri(uri)
        node = apply_domain_override(node, domain_entry)
        node["name"] = build_node_name(group_name, domain_entry)
        nodes.append(node)

    # 2. Deduplicate names
    nodes = deduplicate_names(nodes)

    # 3. Convert to sing-box format
    anti_dpi   = (opts or {}).get("anti_dpi", False)
    client_fp  = (opts or {}).get("client_fingerprint", "random")
    sb_nodes   = [convert_node_to_singbox(n, anti_dpi, client_fp) for n in nodes]

    # 4. Build config
    config  = build_config(sb_nodes, opts)
    content = json.dumps(config, indent=2, ensure_ascii=False)

    # 5. Build filename
    raw_suffix = (user.get("account_name") or "user").lower()
    file_suffix = re.sub(r"[\s_]+", "", raw_suffix)
    filename = f"{FILE_PREFIX}-{file_suffix}.json"

    # 6. Build metadata
    metadata = {}
    expire = user.get("expire_date", "")
    if expire:
        metadata["expire_date"] = expire[:10]
    if unlim:
        metadata["unlimited"] = True
    else:
        # Include data_limit_gb from the user record OR a manually supplied opts value
        data_limit = opts.get("data_limit_gb") or user.get("data_limit_gb")
        if data_limit:
            metadata["data_limit_gb"] = data_limit

    # 7. Upload
    resp = requests.post(
        f"{BACKEND}/api/keyserver/keys",
        json={"filename": filename, "content": content, "metadata": metadata or None},
        headers=HEADERS
    )
    resp.raise_for_status()
    result = resp.json()

    # 8. Build 3 subscription URLs from the JSON file token
    ks = requests.get(f"{BACKEND}/api/keyserver/config", headers=HEADERS).json()
    public_domain = ks.get("publicDomain", "")
    port          = ks.get("port", 8088)
    secret_key    = ks.get("secretKey", "")

    if public_domain:
        base = public_domain.rstrip("/") if public_domain.startswith("http") else f"http://{public_domain}"
    else:
        base = f"http://SERVER_IP:{port}"

    token     = result["token"]
    base_url  = f"{base}/sub/{token}?key={secret_key}"
    sub_url   = base_url                       # Base64 proxy URI list (V2Box / V2RayNG)
    raw_url   = f"{base_url}&format=raw"       # proxy-only sing-box JSON (V2Box, NekoBox)
    v2ray_url = f"{base_url}&format=v2ray"     # full V2Ray/Xray JSON (V2RayNG)

    return {
        "filename":  result["filename"],
        "token":     token,
        "url":       sub_url,    # backward compat — primary subscription URL
        "raw_url":   raw_url,
        "v2ray_url": v2ray_url,
        "content":   content
    }


# ─── Example Usage ────────────────────────────────────────────────────

if __name__ == "__main__":
    # Fetch domains
    domains = requests.get(f"{BACKEND}/api/domains", headers=HEADERS).json()

    # Filter for Unlimited plan
    unlimited_domains = [d for d in domains if d["unlimited"]]

    # Example: 4 SS URIs, one per server
    proxy_uris = [
        "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNzd29yZA==@oldip1:8388#SG01",
        "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNzd29yZA==@oldip2:8388#SG02",
        "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNzd29yZA==@oldip3:8388#SG03",
        "ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNzd29yZA==@oldip4:8388#SG04",
    ]

    # Pair each URI with a domain entry (positional)
    selected_domains = unlimited_domains[:len(proxy_uris)]

    # Find the user
    users = requests.get(
        f"{BACKEND}/api/users/search",
        params={"q": "koyan"},
        headers=HEADERS
    ).json()
    user = users[0]

    result = generate_and_upload(proxy_uris, selected_domains, user, opts={
        "auto_switch_interval": 900,
        "check_interval": 120,
        "global_default": "Proxy",
        "load_balance": False,
        "anti_dpi": False,
    })

    print(f"Uploaded: {result['filename']}")
    print(f"Token:    {result['token']}")
    print(f"URL:      {result['url']}")
```

---

## 17. Verification Checklist

Before uploading, verify the generated JSON passes all checks:

### Structure
- [ ] `log.level` = `"info"`
- [ ] `dns.servers[0]` = `{ "tag": "default-dns", "address": "local" }` (when anti-DPI off)
- [ ] `dns.final` = `"default-dns"` (when anti-DPI off)

### Inbounds
- [ ] TUN inbound has `"tag": "tun-in"`
- [ ] TUN has both `inet4_address` `"172.19.0.1/30"` AND `inet6_address` `"fdfe:dcba:9876::1/126"`
- [ ] TUN has `"auto_redirect_output_mark": 8872`
- [ ] Mixed inbound has `"listen_port": 7890`

### Outbounds
- [ ] Selector `"tag"` = `"proxy"`
- [ ] Selector `"default"` = `"♻️ Auto Switch"`
- [ ] Selector outbounds starts with: `"♻️ Auto Switch"`, `"⚡ Fastest"`, `"🛡️ Failover"`
- [ ] Selector outbounds ends with `"direct"`
- [ ] All 3 urltest group objects are present (`♻️ Auto Switch`, `⚡ Fastest`, `🛡️ Failover`)
- [ ] Node tags are `"{FLAG} {GroupName}[ (Unlimited)] {ServerCode}"` — NOT `"node-1"`
- [ ] Node server values are domain names — NOT raw IPs
- [ ] Shadowsocks outbounds have NO `plugin` or `plugin_opts`
- [ ] `direct`, `dns-out`, `block` outbounds are at the end

### Route
- [ ] First rule: `{ "protocol": "dns", "outbound": "dns-out" }`
- [ ] Second rule: `{ "ip_is_private": true, "outbound": "direct" }`
- [ ] `domain_suffix`, `domain_keyword`, and `ip_cidr` proxy arrays are present and non-empty
- [ ] `route.final` = `"proxy"` (unless user set Direct as global default)
- [ ] `route.auto_detect_interface` = `true`
- [ ] `route.final_ipv6` = `true`

### Experimental
- [ ] `experimental.clash_api.external_controller` = `"127.0.0.1:9090"`
- [ ] `experimental.cache_file.enabled` = `true`
- [ ] `experimental.cache_file.store_fakeip` = `false` (unless anti-DPI + fakeDNS)

### Subscription URLs
- [ ] URL path is `/sub/<token>` — NOT `/files/<filename>`
- [ ] Secret key is `?key=<secretKey>` — NOT `?token=`
- [ ] Three URLs returned: base (default), `&format=raw`, `&format=v2ray`
- [ ] All three URLs use the `.json` file token — NOT a `.txt` file token
