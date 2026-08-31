#!/usr/bin/env bash
# =============================================================================
# add-key-inbound.sh — Add a dedicated TCP+TLS inbound on port 443 for the key
#                      server domain, with a fallback to nginx.
#
# Why this exists:
#   The existing 443 inbound is WebSocket (ws) with serverName x1.vchannel...
#   Xray's WS handler does NOT route other domains (e.g. key.vchannel...) to a
#   fallback. The reliable fix is a SEPARATE tcp+tls inbound on port 443 that
#   matches the key server domain by SNI and falls back to nginx.
#
#   Xray allows multiple inbounds on the same port 443 as long as they use
#   different SNI (server names):
#     - ws inbound:  x1.vchannel.dpdns.org  (VPN, untouched)
#     - tcp inbound: key.vchannel.dpdns.org (key server -> nginx)
#
# This script:
#   1. Backs up the Xray config.
#   2. Adds a tcp+tls inbound on port 443 for the key domain with a fallback
#      to nginx (e.g. 127.0.0.1:8445).
#   3. Validates JSON and restarts Xray.
#
# Usage:
#   sudo ./add-key-inbound.sh \
#       --config /usr/local/x-ui/bin/config.json \
#       --domain key.vchannel.dpdns.org \
#       --cert /etc/letsencrypt/live/key.vchannel.dpdns.org \
#       --dest 127.0.0.1:8445 \
#       [--port 443]
#
# Environment overrides:
#   XRAY_CONFIG, KEY_DOMAIN, CERT_DIR, FALLBACK_DEST, LISTEN_PORT
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[add-key-inbound]\033[0m $*"; }
warn() { echo -e "\033[1;33m[add-key-inbound]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[add-key-inbound]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
XRAY_CONFIG="${XRAY_CONFIG:-}"
KEY_DOMAIN="${KEY_DOMAIN:-}"
CERT_DIR="${CERT_DIR:-}"
FALLBACK_DEST="${FALLBACK_DEST:-127.0.0.1:8445}"
LISTEN_PORT="${LISTEN_PORT:-443}"

# ── Parse args ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --config) XRAY_CONFIG="${2:-}"; shift 2 ;;
    --domain) KEY_DOMAIN="${2:-}";  shift 2 ;;
    --cert)   CERT_DIR="${2:-}";    shift 2 ;;
    --dest)   FALLBACK_DEST="${2:-}"; shift 2 ;;
    --port)   LISTEN_PORT="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: add-key-inbound.sh --config <path> --domain <d> --cert <dir> [options]

Adds a dedicated tcp+tls inbound on port 443 for the key server domain.

Options:
  --config <path>  Path to the Xray config.json (required)
  --domain <d>     Key server domain (required)
  --cert <dir>     Cert dir with fullchain.pem + privkey.pem (required)
  --dest <addr>    Fallback destination (default 127.0.0.1:8445)
  --port <p>       Listen port (default 443)
EOF
      exit 0 ;;
    *)
      err "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$XRAY_CONFIG" ] || [ -z "$KEY_DOMAIN" ] || [ -z "$CERT_DIR" ]; then
  err "Missing required args. Use --config, --domain, --cert."
  exit 1
fi
if [ ! -f "$XRAY_CONFIG" ]; then
  err "Config file not found: $XRAY_CONFIG"
  exit 1
fi
if [ ! -f "$CERT_DIR/fullchain.pem" ] || [ ! -f "$CERT_DIR/privkey.pem" ]; then
  err "Certificate not found in $CERT_DIR (need fullchain.pem + privkey.pem)"
  exit 1
fi

# ── 1. Backup ───────────────────────────────────────────────────────────────
BACKUP="${XRAY_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
cp "$XRAY_CONFIG" "$BACKUP"
log "Backed up config to $BACKUP"

# ── 2. Add the dedicated inbound via Node ───────────────────────────────────
log "Adding tcp+tls inbound on port $LISTEN_PORT for $KEY_DOMAIN -> $FALLBACK_DEST"
node -e "
const fs = require('fs');
const p = '$XRAY_CONFIG';
const domain = '$KEY_DOMAIN';
const certDir = '$CERT_DIR';
const dest = '$FALLBACK_DEST';
const port = Number('$LISTEN_PORT');
const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));

// Check if an inbound for this domain already exists
const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds : [];
const exists = inbounds.some(ib =>
  ib.streamSettings && ib.streamSettings.tlsSettings &&
  ib.streamSettings.tlsSettings.serverName === domain
);
if (exists) {
  console.error('An inbound for ' + domain + ' already exists. Aborting.');
  process.exit(1);
}

const newInbound = {
  listen: '0.0.0.0',
  port: port,
  protocol: 'vless',
  settings: {
    clients: [],
    decryption: 'none',
    fallbacks: []
  },
  streamSettings: {
    network: 'tcp',
    security: 'tls',
    tlsSettings: {
      serverName: domain,
      minVersion: '1.2',
      maxVersion: '1.3',
      rejectUnknownSni: false,
      certificates: [
        {
          certificateFile: certDir + '/fullchain.pem',
          keyFile: certDir + '/privkey.pem',
          ocspStapling: 0,
          oneTimeLoading: false,
          usage: 'encipherment',
          buildChain: false,
          useFile: true
        }
      ],
      alpn: ['h2', 'http/1.1'],
      settings: { fingerprint: 'chrome' },
      fallbacks: [
        { dest: dest, xver: 1 }
      ]
    }
  },
  sniffing: { enabled: false }
};

cfg.inbounds = cfg.inbounds || [];
cfg.inbounds.push(newInbound);
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log('Added dedicated inbound for ' + domain + ' on port ' + port);
"

# ── 3. Validate JSON ────────────────────────────────────────────────────────
if ! node -e "JSON.parse(require('fs').readFileSync('$XRAY_CONFIG','utf-8'))"; then
  err "Invalid JSON after edit. Restoring backup."
  cp "$BACKUP" "$XRAY_CONFIG"
  exit 1
fi
log "JSON is valid."

# ── 4. Restart Xray ─────────────────────────────────────────────────────────
log "Restarting Xray..."
systemctl restart xray 2>/dev/null || systemctl restart x-ui 2>/dev/null || {
  warn "Could not restart Xray automatically. Restart it manually."
}

cat <<EOF

================================================================================
✅ Done. Added a dedicated tcp+tls inbound on port $LISTEN_PORT for $KEY_DOMAIN.

   - VPN (x1.vchannel...) ws inbound: untouched
   - Key server ($KEY_DOMAIN) tcp inbound: -> $FALLBACK_DEST (nginx)

   Backup saved at: $BACKUP
   To revert:       cp $BACKUP $XRAY_CONFIG && systemctl restart xray

Verify (old no-port link):
   curl -k "https://$KEY_DOMAIN/sub/<TOKEN>?key=<KEY>"
================================================================================
EOF
log "Done."