# YAML Generator Bot Guide

## Table of Contents

1. Overview
2. Required APIs
3. End-to-End Algorithm
4. Parsing Rules by Protocol
5. Domain Mapping and Naming
6. YAML Output Structure
7. App Routing Defaults
8. Anti-DPI Behavior
9. Load Balance Behavior
10. Upload and Subscription URL
11. Common Bot Mistakes
12. Verification Checklist

---

## 1. Overview

This guide describes how to reproduce the exact behavior of the YAML Generator page.

Input:
- Proxy URIs (ss://, vmess://, vless://, trojan://, hy2://)
- Optional user/account name
- Optional domain mapping preference
- Optional settings (Unlim, Anti-DPI, LB, Global Default)

Output:
- Clash/Mihomo YAML config
- Saved file on key server via API
- Subscription URL in this format:
  - http://<host>/sub/<token>?key=<secretKey>

---

## 2. Required APIs

### 2.1 Search user (optional)

GET /api/users/search?q=<term>

Used for:
- Auto filename suffix from account_name
- Expire date comment in YAML header

### 2.2 Fetch domains

GET /api/domains

Domain object:
- id
- domain
- server
- service
- unlimited

Filter logic:
- Unlim=true: keep unlimited===true
- Unlim=false: keep service=="Premium" and unlimited===false

### 2.3 Save YAML

POST /api/keyserver/keys

Body:
{
  "filename": "vchannel-config-koyan.yaml",
  "content": "<yaml string>"
}

Note:
- YAML save does not send metadata in current page implementation.

### 2.4 Build subscription URL

GET /api/keyserver/config

Use fields:
- publicDomain
- port
- secretKey

URL:
- /sub/<token>?key=<secretKey>

For YAML files, key server serves the file content directly.

---

## 3. End-to-End Algorithm

1. Parse proxy URIs to node objects.
2. If single-node mode with selected server, override node server and related host/sni fields.
3. Build normalized display names using server code and group name.
4. Deduplicate names by appending A/B/C.
5. Build YAML header and base settings.
6. Build proxies list.
7. Build proxy-groups:
- Main select group
- Auto Switch (url-test)
- Fastest (url-test)
- Failover (fallback)
- Optional Load Balance group
8. Build routing rules from app routing + custom rules.
9. Add final MATCH rule based on Global Default.
10. Upload YAML to key server.
11. Build and return subscription URL.

---

## 4. Parsing Rules by Protocol

### 4.1 Shadowsocks

Pattern:
- ss://BASE64(cipher:password)@host:port#name
- ss://...@host:port/?outline=1&prefix=<value>#name

Parse:
- type=ss
- server, port
- cipher, password
- udp=true

Special:
- prefix query is stored internally as _prefix
- _prefix is never written to YAML

### 4.2 VMess

Pattern:
- vmess://BASE64(JSON)

Parse core fields:
- type=vmess
- server=json.add
- port=json.port
- uuid=json.id
- alterId=json.aid or 0
- cipher=json.scy or auto
- udp=true
- skip-cert-verify=true
- network=json.net (if provided)
- tls=true if json.tls=="tls"
- servername=json.host (if provided)

WS case:
- ws-opts.path=json.path or /
- ws-opts.headers.Host=json.host or json.add

### 4.3 VLESS

Parse core fields:
- type=vless
- server, port
- uuid
- udp=true
- skip-cert-verify=true
- client-fingerprint=params.fp or chrome
- network=params.type or params.network

TLS case:
- tls=true
- servername=params.sni (if provided)

WS case:
- udp=false
- alpn=["http/1.1"]
- optional flow
- ws-opts.path
- ws-opts.headers.Host

### 4.4 Trojan

Parse:
- type=trojan
- server, port
- password
- udp=true
- skip-cert-verify=true
- optional sni
- optional network

WS case:
- ws-opts.path
- ws-opts.headers.Host

### 4.5 Hysteria2

Accept:
- hy2://...
- hysteria2://...

Parse:
- type=hysteria2
- server, port
- password
- udp=true
- skip-cert-verify=true
- sni=params.sni or host

---

## 5. Domain Mapping and Naming

### 5.1 Domain override

When mapping node to selected domain entry:
- node.server = domain_entry.domain
- ws-opts.headers.Host = domain_entry.domain (if exists)
- node.servername = domain_entry.domain (if exists)
- node.sni = domain_entry.domain (if exists)

### 5.2 Name format

Country code from server label prefix (SG01 -> SG).

Flag map:
- SG, HK, US, JP, ID, TH, VN, UK, CN, IN, AU

Tag format:
- {FLAG} {GroupName}[ (Unlimited)] {ServerCode}

Example:
- "🇸🇬 VChannel-Premium (Unlimited) SG01"

### 5.3 Deduplication

If duplicate names exist:
- Append A, B, C in insertion order.

---

## 6. YAML Output Structure

Header comments:
- # <display name>
- # Expire Date: YYYY-MM-DD (if present)
- # profile-update-interval: <updateInterval>

Core keys:
- mixed-port: 7890
- allow-lan: true
- mode: rule
- log-level: info
- ipv6: true
- external-controller: 127.0.0.1:9090

TUN block (always included):
- tun:
  - enable: true
  - stack: system
  - mtu: 1400
  - auto-route: true
  - auto-detect-interface: true

Top sections order:
1. proxies:
2. proxy-groups:
3. rules:

### 6.1 Main proxy group

Main group name:
- "🚀 {GroupName}" or "🚀 {GroupName} (Unlimited)"

Includes:
- ♻️ Auto Switch
- ⚡ Fastest
- 🛡️ Failover
- optional ⚖️ Load Balance / ⚖️ Static Balance
- DIRECT
- all node names

### 6.2 Health-check groups

- Auto Switch: type=url-test, interval=autoSwitchInterval, tolerance=150, lazy=true
- Fastest: type=url-test, interval=checkInterval, tolerance=50, lazy=true
- Failover: type=fallback, interval=checkInterval, lazy=true
- Load Balance (when enabled): lazy=true

URL for checks:
- http://www.gstatic.com/generate_204

---

## 7. App Routing Defaults

Default proxy apps:
- Netflix, YouTube, Facebook, Instagram, Messenger, Threads, Twitter, TikTok
- WhatsApp, Telegram, Signal, Discord, Spotify, ChatGPT, GitHub

Default direct apps:
- Google, Microsoft, Apple, Amazon

Rule generation:
- DOMAIN-SUFFIX and DOMAIN-KEYWORD entries from app tables
- IP-CIDR and IP-CIDR6 entries preserved with no-resolve

Custom rules:
- If looks like IPv4: IP-CIDR,<ip>/32,<target>
- Otherwise: DOMAIN-SUFFIX,<domain>,<target>

Final rule:
- MATCH,<main-group> when Global Default=Proxy
- MATCH,DIRECT when Global Default=Direct

---

## 8. Anti-DPI Behavior

If antiDPI=true:
- tcp-concurrent: true (when enabled)
- global-client-fingerprint: selected value
- keep-alive-interval: 30

If tlsFragment=true:
- tls-fragment:
  - enable: true
  - length: "<fragmentLength>"
  - interval: "<fragmentInterval>"

If fakeDNS=true:
- sniffer block enabled

If dohEnabled=true:
- dns block enabled
- nameserver list includes selected DoH plus fallback DoH endpoints

Per-node effect:
- client-fingerprint set
- skip-cert-verify=true

---

## 9. Load Balance Behavior

When LB is enabled:
- Add load-balance group

Mode mapping:
- Static off: name="⚖️ Load Balance", strategy=round-robin
- Static on: name="⚖️ Static Balance", strategy=consistent-hashing

---

## 10. Upload and Subscription URL

### 10.1 Save

POST /api/keyserver/keys with YAML filename/content.

Typical filename:
- <prefix>-<suffix>.yaml

### 10.2 URL

Read config from /api/keyserver/config.

Build host:
- publicDomain with scheme if present
- otherwise fallback to http://SERVER_IP:port

Final URL:
- <base>/sub/<token>?key=<secretKey>

Notes:
- token is path segment
- key is query parameter
- for YAML, file is served directly as text

---

## 11. Common Bot Mistakes

1. Generating JSON instead of YAML.
2. Saving .json extension for YAML content.
3. Writing _prefix into YAML node.
4. Forgetting final MATCH rule.
5. Missing required proxy groups.
6. Not applying domain override to Host/SNI/servername.
7. Wrong filter logic for Unlim toggle.
8. Removing no-resolve from IP-CIDR app rules.
9. Using /sub/<token>?token=<token> instead of ?key=<secretKey>.
10. Assuming YAML supports format=raw/v2ray conversions for YAML workflow.

---

## 12. Verification Checklist

Before save:
- [ ] Output is valid YAML text.
- [ ] Filename ends with .yaml.
- [ ] All proxies have required protocol fields.
- [ ] Internal fields (like _prefix) are not present in YAML.
- [ ] Main group and 3 health-check groups exist.
- [ ] MATCH rule is last.
- [ ] Global default behavior is correct.
- [ ] Optional Anti-DPI blocks are consistent.
- [ ] Subscription URL uses /sub/<token>?key=<secretKey>.

After save:
- [ ] API returns filename and token.
- [ ] Subscription URL opens and serves YAML content.
