# JSON Generator — User Guide

A step-by-step guide for using the JSON Generator page to create sing-box configuration files for your customers.

---

## Table of Contents

1. [What is the JSON Generator?](#1-what-is-the-json-generator)
2. [Page Layout Overview](#2-page-layout-overview)
3. [Top Bar Settings](#3-top-bar-settings)
4. [User Search](#4-user-search)
5. [Step 1 — Bulk Import](#5-step-1--bulk-import)
6. [Step 2 — Add Single Node](#6-step-2--add-single-node)
7. [Step 3 — Custom Domain / IP Rules](#7-step-3--custom-domain--ip-rules)
8. [Step 4 — App Routing Manager](#8-step-4--app-routing-manager)
9. [Active Nodes Panel](#9-active-nodes-panel)
10. [Step 5 — Final Configuration & Export](#10-step-5--final-configuration--export)
11. [Advanced Settings](#11-advanced-settings)
12. [Anti-DPI / Censorship Evasion](#12-anti-dpi--censorship-evasion)
13. [Load Balance Mode](#13-load-balance-mode)
14. [Common Workflows](#14-common-workflows)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. What is the JSON Generator?

The JSON Generator creates **sing-box** format configuration files (`.json`) for VPN customers. These configs:

- Work with the **sing-box** app (Android, iOS, Windows, macOS, Linux)
- Include automatic server health checking and failover
- Route specific apps (Netflix, Telegram, YouTube, etc.) through the VPN or directly
- Can be saved to the key server, giving customers a subscription URL they can update automatically

The generated config is a complete, ready-to-use sing-box profile — the customer just imports it into their app.

---

## 2. Page Layout Overview

The page is split into two main columns:

```
┌─────────────────────────────────────────────────────────┐
│                    TOP BAR SETTINGS                      │
│  [Group Name] [Unlim] [LB] [Expire] [Data Limit] [⚙] [🛡] │
├────────────────────────┬────────────────────────────────┤
│       LEFT COLUMN      │       RIGHT COLUMN              │
│                        │                                 │
│  Step 1: Bulk Import   │  Active Nodes List              │
│  Step 2: Add Single    │                                 │
│  Step 3: Custom Rules  │  Step 5: Final Config           │
│  Step 4: App Routing   │    Filename / Save / Export     │
│                        │    JSON Output Preview          │
└────────────────────────┴────────────────────────────────┘
```

The JSON preview on the right updates **live** as you change any setting — you'll always see exactly what will be saved.

---

## 3. Top Bar Settings

The top bar controls global settings that apply to the entire config.

### Group Name

The label that appears in every node name. Default: `VChannel-Premium`.

```
Example: "VChannel-Premium" → node tags like "🇸🇬 VChannel-Premium (Unlimited) SG01"
```

Change this for different customer tiers (e.g. `VChannel-Basic`, `VChannel-Mini`).

### Unlim (Unlimited Checkbox)

When ticked:
- Adds `(Unlimited)` to every node name
- Filters the domain server dropdown to show **only Unlimited pool** servers
- Sets `"unlimited": true` in the saved metadata

When unticked:
- Shows Premium (non-unlimited) servers in the dropdown
- Data Limit field becomes visible

### LB (Load Balance Checkbox)

Adds a 4th selection group called **⚖️ Load Balance** (or **⚖️ Balanced** if Static is also ticked). See [Section 13](#13-load-balance-mode).

### Expire Date

The date when this customer's subscription expires. Stored as metadata alongside the config on the key server. Used by subscription clients to show remaining time.

Format: `YYYY-MM-DD` (use the date picker).

### Data Limit (GB)

Only visible when **Unlim is unticked**. Sets the data cap in GB. Stored as metadata. Default: `150`.

### Anti-DPI Button (🛡️ Shield icon)

Toggles the Anti-DPI panel. Use this for customers in countries with internet censorship or throttling. See [Section 12](#12-anti-dpi--censorship-evasion).

### Advanced Settings Button (⚙️ Gear icon)

Opens the Advanced Settings panel for tuning health check intervals and routing defaults. See [Section 11](#11-advanced-settings).

---

## 4. User Search

The user search field lets you quickly auto-fill the filename suffix and metadata without typing manually.

### How to use

1. Click the **Search User** field (top-right of the top bar)
2. Type at least 2 characters of the customer's account name
3. A dropdown appears — click the correct customer
4. The following fields are auto-filled:
   - **Filename Suffix** → derived from `account_name` (lowercase, spaces removed)
   - **Expire Date** → from the user's `expire_date` in the database
   - **Unlim checkbox** → if the user's `data_limit_gb` is null, Unlim is ticked
   - **Data Limit** → from the user's `data_limit_gb`

### What is shown in the dropdown

Each result shows:
- Customer name
- Server tag (e.g. `SG Premium`)
- Expiry date

### After selecting a user

A blue info bar appears below the search field showing the selected customer's name, service type, and expiry. The filename preview at the bottom of the page updates immediately.

---

## 5. Step 1 — Bulk Import

Use Bulk Import when you have **multiple proxy links** to add at once.

### Supported proxy URI formats

- `ss://` — Shadowsocks
- `vmess://` — VMess
- `vless://` — VLESS
- `trojan://` — Trojan
- `hy2://` or `hysteria2://` — Hysteria2

### How to use

1. Paste all your proxy links into the text area — **one per line**
2. Click **Process Keys**
3. All valid links are parsed and appear in the **Active Nodes** list on the right
4. Invalid lines are silently skipped

### What happens automatically

- **Duplicate names** are given letter suffixes (A, B, C...) so every node tag is unique
- **Duplicate server hostnames** are auto-incremented: if `pb01.domain.com` appears 3 times, they become `pb01`, `pb02`, `pb03` automatically

> ⚠️ **Important:** Bulk import does NOT apply a domain server override. The nodes will keep the raw server address from the URI. If you need to replace addresses with your domain pool, use **Step 2 (Add Single Node)** instead — or edit nodes individually.

### Clear

Click the **Clear** button to empty the text area without affecting already-added nodes.

---

## 6. Step 2 — Add Single Node

Use this to add one node at a time and assign it a **domain server** from your pool, replacing the raw IP/host with a managed domain name.

### Fields

| Field | Purpose |
|---|---|
| Proxy link input | Paste one `ss://`, `vmess://`, etc. URI |
| Server dropdown | Select which domain entry to use for this node |
| ADD button | Adds the node to the Active Nodes list |

### The Server Dropdown

The dropdown shows domains from your **Domains** table, filtered by the **Unlim** checkbox:
- **Unlim ticked** → shows only Unlimited pool servers
- **Unlim unticked** → shows only Premium (non-unlimited) servers

Each option shows: `SG01 — pul01.vchannel.dpdns.org (Premium Unlimited)`

### What happens when you select a server

When you click **ADD** with a server selected, the generator:
1. Parses the proxy URI as usual (extracts cipher, password, port, etc.)
2. **Replaces the server address** with the selected domain's FQDN
3. Also updates any TLS SNI, WebSocket Host header, or Trojan SNI to match the domain
4. **Builds the node name** in the standard format: `{FLAG} {GroupName}[ (Unlimited)] {ServerCode}`

**Example:**
- Input URI: `ss://...@159.89.207.135:8388#SG01`
- Selected server: `SG01 — pul01.vchannel.dpdns.org`
- Result node: tag = `🇸🇬 VChannel-Premium (Unlimited) SG01`, server = `pul01.vchannel.dpdns.org`

### Adding without a server selection

If you leave the dropdown at `-- Select Server --`, the node is added with the raw address from the URI. The node name is taken from the `#fragment` of the URI with a flag emoji prepended if the name contains a country code.

---

## 7. Step 3 — Custom Domain / IP Rules

Add extra routing rules on top of the standard 19-app routing.

### Input format

Type domains or IPs separated by commas:
```
netflix.com, 1.2.3.4, custom-site.com
```

- Plain domains → added as `domain_suffix` rules
- IP addresses (e.g. `1.2.3.4`) → added as `/32` CIDR rules

### Buttons

| Button | Effect |
|---|---|
| **Add to Proxy** | These addresses will go through the VPN |
| **Add to Direct** | These addresses will bypass the VPN |

### Viewing and managing custom rules

After adding, the rules appear as coloured tags below the input:
- **Green tags** = proxy rules
- **Blue/grey tags** = direct rules

Currently there is no per-rule delete — to remove a custom rule, you need to reload the page (custom rules are not persisted to localStorage).

---

## 8. Step 4 — App Routing Manager

Control which of the 19 built-in apps go through the VPN and which bypass it.

### How it works

Each app is a toggle button:
- **Green** = VPN enabled (app traffic goes through the VPN)
- **Grey** = Direct / bypass (app traffic goes directly to the internet)

Click any app button to toggle it between proxy and direct.

### Default settings (out of the box)

| Via VPN (Green) | Direct / Bypass (Grey) |
|---|---|
| Netflix | Google |
| YouTube | Microsoft |
| Facebook | Apple |
| Instagram | Amazon |
| Messenger | |
| Threads | |
| Twitter / X | |
| TikTok | |
| WhatsApp | |
| Telegram | |
| Signal | |
| Discord | |
| Spotify | |
| ChatGPT / OpenAI | |
| GitHub | |

### Saving your preferences

Click **Save Routing** to persist your app routing choices to your browser's local storage. They will be remembered the next time you open the JSON Generator.

> **Why is Google on Direct?** Google services (googleapis.com, gstatic.com) are often used by sing-box itself for health checks (`generate_204`) and for loading web content. Routing them through the VPN can cause issues. Recommended to leave on Direct.

---

## 9. Active Nodes Panel

The Active Nodes list (top of the right column) shows all nodes currently in the config.

### What each row shows

```
🇸🇬 VChannel-Premium (Unlimited) SG01   [SS]   pul01.vchannel.dpdns.org:8388   [🗑]
```

| Column | Meaning |
|---|---|
| Node name | The tag used in the sing-box config |
| Protocol badge | `SS`, `VMESS`, `VLESS`, `TROJAN`, `HYSTERIA2` |
| Server:Port | The actual server address and port |
| Delete button | Removes this node from the config |

### Managing nodes

| Action | How |
|---|---|
| Remove one node | Click the trash icon on that row |
| Remove all nodes | Click **Clear All** in the panel header |
| Export as raw URIs | Click **Export** — downloads a `.txt` file with one URI per line |
| Download V2Box subscription | Click **V2Box Sub** — downloads a `.txt` file with `//profile-title` and `//subscription-userinfo` headers for V2Box-compatible clients |

### Duplicate node tags

If you add two nodes with the same name (e.g. the same server twice), they get letter suffixes: `SG01 A`, `SG01 B`. This happens automatically.

---

## 10. Step 5 — Final Configuration & Export

### Filename

The filename is built from two parts:

```
{Prefix}  —  {Suffix} .json
vchannel-config — koyan .json
```

| Field | Default | Persistent? |
|---|---|---|
| **Prefix** | `vchannel-config` | ✅ Saved to browser storage when you click 💾 |
| **Suffix** | _(empty)_ | ❌ Per session only (auto-filled by User Search) |

The **File** preview line shows exactly what the filename will be before you save.

#### Save TXT File checkbox

When ticked, saving to the server will **also** create a V2Box plain-text subscription file (`.txt`) alongside the `.json`.

### Action buttons

| Button | What it does |
|---|---|
| **Copy** | Copies the JSON to clipboard |
| **Save File** | Downloads the `.json` directly to your computer |
| **Save to Server** | Uploads the config to the key server and generates a subscription token/URL |

### Save to Server

When you click **Save to Server**:
1. The JSON is sent to `POST /api/keyserver/keys`
2. A unique access token is generated for this file
3. If **Save TXT File** is checked, the V2Box `.txt` is also uploaded
4. Three subscription URLs appear below the buttons:

| Label | URL format | Best for |
|---|---|---|
| **📋 Sub URL** | `…/sub/{token}?key={key}` | V2Box or V2RayNG — paste into "Add Subscription" |
| **📦 Raw URL** | `…?key={key}&format=raw` | V2Box or NekoBox sing-box subscription |
| **⚙️ V2Ray URL** | `…?key={key}&format=v2ray` | V2RayNG — import as V2Ray/Xray JSON config |

Give the customer the URL that matches their app. For most customers, the **Sub URL** works in any standard subscription client.

The subscription URL format is:
```
http://<key-server-domain>/sub/<token>?key=<secretKey>
```

### JSON preview

The large text area shows the current generated JSON in real time. It is read-only — every change you make on the left side is immediately reflected here. Scroll through it to verify the config before saving.

---

## 11. Advanced Settings

Click the ⚙️ gear icon to open the Advanced Settings panel.

| Setting | Default | Description |
|---|---|---|
| **Update Interval (hours)** | `24` | How often V2Box clients check for config updates. Only applies to the `.txt` V2Box subscription format, not the sing-box JSON. |
| **Health Check (s)** | `120` | How often the **⚡ Fastest** and **🛡️ Failover** groups test server speed (in seconds). |
| **Auto Switch (s)** | `900` | How often the **♻️ Auto Switch** group tests server speed. Longer interval = less overhead. |
| **Global Default** | `Proxy` | What happens to traffic that matches no routing rules. `Proxy` = goes through VPN (recommended). `Direct` = bypasses VPN. |

Click **Save Settings** to persist these values to your browser for future sessions.

### What these affect in the config

```
♻️ Auto Switch  →  interval: "{Auto Switch}s",  tolerance: 150
⚡ Fastest       →  interval: "{Health Check}s",  tolerance: 50
🛡️ Failover      →  interval: "{Health Check}s",  tolerance: 300
route.final      →  "proxy" if Global Default = Proxy, "direct" if Direct
```

---

## 12. Anti-DPI / Censorship Evasion

Click the 🛡️ shield button to open the Anti-DPI panel. Use these settings for customers in countries with censorship, deep packet inspection (DPI), or ISP throttling.

> Enabling this changes the DNS section of the config significantly — see below for what each option does.

### TCP Concurrent

| Default | On |
|---|---|
| Standard TCP | Tries multiple IPs simultaneously |

Reduces connection time on congested networks. Adds `"dial_fields": { "tcp_multi_path": true, "tcp_fast_open": true }` to the config.

### TLS Fingerprint

Makes the TLS handshake look like it came from a real browser or device instead of a VPN client. Options:

| Value | Description |
|---|---|
| **Random (Best)** | Rotates fingerprints — hardest to detect |
| Chrome | Mimics Google Chrome |
| Firefox | Mimics Mozilla Firefox |
| Safari | Mimics Apple Safari |
| Edge | Mimics Microsoft Edge |
| iOS | Mimics Safari on iPhone |
| Android | Mimics Chrome on Android |
| 360 / QQ | Chinese browser fingerprints |

Adds `"utls": { "enabled": true, "fingerprint": "..." }` to every TLS outbound.

### DNS over HTTPS (DoH)

Encrypts DNS queries so your ISP cannot see which domains you're looking up (and cannot block or redirect them). When enabled, the config uses a full DoH setup instead of local DNS.

**DoH Server options:**

| Server | Best for |
|---|---|
| **Cloudflare (1.1.1.1)** | General use, fast, global |
| Google DNS | Good fallback |
| Quad9 (Secure) | Blocks malicious domains |
| OpenDNS | Parental controls available |
| AdGuard DNS | Ad blocking |

The config always includes Cloudflare and Google DNS as backups regardless of which primary you select.

### Fake-IP Mode

Instead of resolving real IPs, sing-box assigns fake internal IPs to domain lookups. Benefits:
- Prevents DNS leaks
- Faster routing decisions
- Best for maximum evasion

⚠️ Some apps may behave unexpectedly with fake IPs. Test before deploying widely.

### TLS Fragment

Splits the TLS `ClientHello` packet into smaller pieces. This defeats SNI-based DPI filters that block VPN traffic by reading the server name in the TLS handshake.

When enabled, two extra fields appear:
- **Fragment Length** — size range of each fragment, e.g. `10-30` (bytes)
- **Fragment Interval (ms)** — delay between fragments, e.g. `10-20` (milliseconds)

Default values work for most cases. Only tune these if the customer reports connection problems.

### SS Prefix

Prepends specific bytes to Shadowsocks connections to disguise them at the TCP level. The prefix value is URL-encoded bytes (default: `%16%03%01%00%C2%A8%01%01` which mimics a TLS ClientHello record header).

> **Note:** This only affects subscription URIs generated for V2Box-compatible clients. The URI format uses `/?outline=1&prefix=` (e.g. `ss://…@host:port/?outline=1&prefix=%16%03%01…`). It does NOT modify the sing-box JSON config — sing-box handles obfuscation differently via the TLS fingerprint settings.

### Saving Anti-DPI settings

Click **Save Anti-DPI Settings** to persist your choices. They are remembered across sessions.

---

## 13. Load Balance Mode

Tick the **LB** checkbox in the top bar to enable Load Balance mode.

### What changes

A 4th outbound group is added: **⚖️ Load Balance**

The selector outbounds become:
```
♻️ Auto Switch  →  ⚡ Fastest  →  🛡️ Failover  →  ⚖️ Load Balance  →  [individual nodes]  →  direct
```

The Load Balance group uses an `idle_timeout: 30m` setting that spreads sessions across multiple servers after 30 minutes of idle time, giving a pseudo-load-balancing effect within sing-box.

### Static Balance option

When **LB** is ticked, a **Static** checkbox appears:

| Mode | Tag | Behaviour |
|---|---|---|
| Load Balance (default) | `⚖️ Load Balance` | Dynamic, shifts after idle |
| Static | `⚖️ Balanced` | Same group but labelled as static |

---

## 14. Common Workflows

### Workflow A — Quick single-user config (Unlimited plan)

1. Tick **Unlim**
2. Type the customer name in **Search User**, select them
3. In **Step 2**, paste the SS/VMess URI, select `SG01` from the server dropdown, click **ADD**
4. Repeat for SG02, SG03, SG04
5. Go to **Step 5**, confirm the filename shows `vchannel-config-{username}.json`
6. Click **Save to Server**
7. Copy the **Sub URL** that appears and send it to the customer (or the Raw/V2Ray URL if they use NekoBox/V2RayNG)

---

### Workflow B — Adding multiple nodes at once (Bulk Import)

1. Set Group Name and Unlim as appropriate
2. In **Step 1**, paste all proxy URIs (one per line), click **Process Keys**
3. Check the Active Nodes list — verify names look correct
4. Go to **Step 5**, set the filename suffix manually, click **Save to Server**

> ⚠️ Bulk import keeps the raw server addresses from the URIs. If you need domain pool addresses instead, add nodes one by one using Step 2.

---

### Workflow C — Sending config to a censored-country customer

1. Set up nodes as normal (Steps 1–2)
2. Click the 🛡️ shield button to open Anti-DPI panel
3. Enable: **TLS Fingerprint** (Random), **DNS over HTTPS** (Cloudflare), **Fake-IP Mode**
4. Optionally enable **TLS Fragment** if the customer reports TLS blocking
5. Click **Save Anti-DPI Settings**
6. Save to server as usual

---

### Workflow D — Creating configs for multiple customers

1. Set up Group Name, Unlim, and add all nodes (Steps 1–2) — these stay the same for all customers
2. For each customer:
   - Search for the customer in **User Search** (this updates expiry, data limit, and filename suffix)
   - Click **Save to Server**
   - Copy the URL and send to customer
3. The nodes and routing settings remain unchanged between saves — only the filename and metadata change per customer

---

### Workflow E — Changing app routing for a customer tier

Example: You want a Basic plan config where Google also goes through VPN:

1. In **Step 4**, find the **Google** button (currently grey/Direct)
2. Click it — it turns green (Proxy)
3. Click **Save Routing** to remember this setting for future sessions
4. Add nodes and save as usual

---

## 15. Troubleshooting

### The server dropdown is empty

The domain pool is empty. Go to the **Domains** page and add domain entries first. Make sure entries have `service = "Premium"` and the correct `unlimited` flag.

### Node names show raw hostnames instead of flag + name format

This happens when nodes are added via **Bulk Import** without a server selection, or when the server code in the domain entry (`SG01`, `HK02`, etc.) doesn't start with a two-letter country code in the flag map.

Supported country codes: `SG`, `HK`, `US`, `JP`, `ID`, `TH`, `VN`, `UK`, `CN`, `IN`, `AU`.

### Save to Server fails

- Check you are logged in with Admin or Server Admin role
- Check the key server is running (`Settings → Key Server`)
- Check the `configDir` is writable on the server
- Look at the error message shown in red next to the Save to Server button

### The JSON preview is empty

Add at least one node. The generator technically works with zero nodes (producing an empty outbounds list) but the preview will show a minimal config. Add nodes in Step 1 or Step 2.

### Customer reports connection not working

1. Check the node server address in Active Nodes — should be a domain name, not a raw IP
2. Verify the domain is reachable from the customer's location
3. If the customer is in a censored region, enable Anti-DPI settings and regenerate
4. Check the Expire Date is not in the past

### Bulk import parsed 0 nodes

All pasted lines were invalid. Common causes:
- Lines contain extra spaces or invisible characters before the `ss://` / `vmess://` prefix
- Lines are Clash YAML format (`- {name: ..., type: ...}`) — the generator does not support YAML node format, only URI strings

### Two nodes have the same tag / duplicate detection

If two nodes end up with the same tag name, the generator appends A, B, C... automatically. If you see `SG01 A` and `SG01 B`, it means two nodes were given the same server code. This is normal and intentional — both nodes will still work.

### Subscription URLs do not appear after saving

Subscription URLs are shown whenever **Save to Server** succeeds — they do not require the **Save TXT File** checkbox. If no URLs appear, check for a red error message next to the button (key server may be unreachable or the config directory may not be writable).

### Settings reset after reload

- **App Routing** — only persisted if you clicked **Save Routing**
- **Advanced Settings** — only persisted if you clicked **Save Settings**
- **Anti-DPI Settings** — only persisted if you clicked **Save Anti-DPI Settings**
- **Filename Prefix** — only persisted if you clicked the 💾 icon next to the prefix field
- **Group Name, Unlim, LB, Expire, Data Limit** — these are NOT persisted — re-enter each session
