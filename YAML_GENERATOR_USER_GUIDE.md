# YAML Generator User Guide

## Table of Contents

1. What this page does
2. Top bar settings
3. User Search
4. Step 1 - Bulk Import
5. Step 2 - Add Single Node
6. Step 3 - Custom Domain/IP Rules
7. Step 4 - App Routing Manager
8. Active Nodes panel
9. Step 5 - Final Configuration
10. Advanced Settings
11. Anti-DPI Settings
12. Load Balance Mode
13. Common workflows
14. Troubleshooting

---

## 1. What this page does

YAML Generator builds Clash/Mihomo YAML configs from proxy URIs.

You can:
- Paste multiple links (bulk)
- Add one node with explicit server mapping
- Configure app routing
- Enable Anti-DPI options
- Save YAML to file or key server

---

## 2. Top bar settings

### Group Name
- Default: VChannel-Premium
- Used in main proxy group and mapped node names.

### Unlim
- When enabled, server dropdown shows only unlimited domain entries.
- Also changes display label to include (Unlimited).

### LB and Static
- LB adds load-balance group.
- Static switches LB strategy to consistent-hashing.

### Expire Date
- Added as header comment in YAML.
- Also auto-filled when selecting a user with expire_date.

### Shield button
- Toggles Anti-DPI panel.

### Gear button
- Toggles Advanced Settings panel.

---

## 3. User Search

Search User helps with naming and expiration convenience.

When you pick a user:
- Filename suffix becomes account_name lowercased with spaces/underscores removed.
- Expire Date field is filled from user expire_date.

Example:
- "Ko Yan" -> suffix "koyan" -> filename vchannel-config-koyan.yaml

---

## 4. Step 1 - Bulk Import

Paste one URI per line.

Supported:
- ss://
- vmess://
- vless://
- trojan://
- hy2:// or hysteria2://

Click Process Keys.

What happens:
- Valid links are parsed into nodes.
- Duplicate names are auto-suffixed A/B/C.
- If duplicate host pattern matches pb/pul/ou/ps prefixes, domain auto-increment may apply.

---

## 5. Step 2 - Add Single Node

Use this when you want precise domain mapping.

Flow:
1. Paste one proxy URI.
2. Pick a server from dropdown.
3. Click ADD.

Result:
- Node host is replaced with selected domain.
- Host/SNI/servername are also updated where relevant.
- Node name is rebuilt as:
  - {FLAG} {GroupName}[ (Unlimited)] {ServerCode}

---

## 6. Step 3 - Custom Domain/IP Rules

Input comma-separated values.

Examples:
- netflix.com, openai.com
- 1.1.1.1, 8.8.8.8

Buttons:
- Add to Proxy
- Add to Direct

Rule output:
- IPv4 entry -> IP-CIDR,<ip>/32,...
- Domain entry -> DOMAIN-SUFFIX,<domain>,...

---

## 7. Step 4 - App Routing Manager

Each app button toggles between Proxy and Direct.

Default Proxy apps include:
- Netflix, YouTube, Facebook, Instagram, Messenger, Threads, Twitter, TikTok
- WhatsApp, Telegram, Signal, Discord, Spotify, ChatGPT, GitHub

Default Direct apps:
- Google, Microsoft, Apple, Amazon

Click Save Routing to persist your choices in browser storage.

---

## 8. Active Nodes panel

Shown only when at least one node exists.

You can:
- Export: download URI list as text file
- Clear All: remove all current nodes
- Delete per-node from the list

---

## 9. Step 5 - Final Configuration

### Filename fields
- Prefix: default vchannel-config (click save icon to persist)
- Suffix: optional (often auto-filled by User Search)
- Preview shows final filename before saving

### Buttons
- Copy: copies generated YAML
- Save File: downloads .yaml file
- Save to Server: uploads to key server

### Save to Server behavior
On success, server returns filename and token.
Use token with key server secret to form subscription URL:
- http://<host>/sub/<token>?key=<secretKey>

For YAML files, this URL serves YAML content directly.

---

## 10. Advanced Settings

Fields:
- Update Interval (hours)
- Health Check (s)
- Auto Switch (s)
- Global Default (Proxy or Direct)

Effects:
- Update Interval appears in YAML header comment.
- Health Check and Auto Switch control group probe intervals.
- Global Default controls final MATCH target.

Click Save Settings to persist in browser storage.

---

## 11. Anti-DPI Settings

Available options:
- TCP Concurrent
- TLS Fingerprint
- DNS over HTTPS
- DoH server selection
- Fake-IP Mode
- TLS Fragment
- Fragment Length / Interval

When enabled, generator adds anti-censorship blocks to YAML:
- tcp-concurrent/global-client-fingerprint
- optional tls-fragment
- optional sniffer/fake-ip DNS profile

Click Save Anti-DPI Settings to persist in browser storage.

---

## 12. Load Balance Mode

When LB is on:
- Adds load-balance group to proxy-groups.

Modes:
- LB + Static off -> round-robin
- LB + Static on -> consistent-hashing

---

## 13. Common workflows

### Workflow A - Quick customer config
1. Search and select user.
2. Add nodes in Step 2 with mapped domain servers.
3. Verify Active Nodes count.
4. Save to server and share subscription URL.

### Workflow B - Bulk import then tune routing
1. Paste links in Step 1 and process.
2. Toggle app routes in Step 4.
3. Set Global Default.
4. Save file or server.

### Workflow C - Restricted network customer
1. Enable Anti-DPI.
2. Set TLS fingerprint random.
3. Enable DoH.
4. Optionally enable TLS Fragment.
5. Save config and test.

---

## 14. Troubleshooting

### No servers in dropdown
- Domain pool may be empty or filtered out by Unlim toggle.
- Check domain entries in Domain Manager.

### Save to Server fails
- Check admin/server-admin login token.
- Check key server status and config directory permissions.

### YAML looks empty
- Ensure at least one valid node is active.

### Wrong filename
- Prefix persists only after clicking prefix save button.
- Suffix may be overridden when selecting a user.

### Node still shows old host
- Use Step 2 with selected server for explicit domain override.
- Bulk import alone keeps parsed host unless auto-increment logic changes it.

### Customer cannot import subscription
- Verify URL format: /sub/<token>?key=<secretKey>
- Confirm secret key is correct and token exists.
