#!/usr/bin/env bash
# =============================================================================
# add-xray-fallback.sh — Add a fallback to the Xray 443 inbound by editing the
#                        config file DIRECTLY (with a backup).
#
# Why this exists:
#   The 3x-ui panel strips the `fallbacks` field from WebSocket inbounds on
#   save, so you cannot add a fallback through the panel UI. The only reliable
#   way is to edit the actual Xray config file on disk.
#
# This script:
#   1. Backs up the Xray config file.
#   2. Finds the inbound that listens on port 443.
#   3. Adds a `fallbacks` array pointing to nginx (e.g. 127.0.0.1:8444).
#   4. Validates the JSON and restarts Xray.
#
# Usage:
#   sudo ./add-xray-fallback.sh \
#       --config /usr/local/x-ui/bin/config.json \
#       --dest 127.0.0.1:8444 \
#       [--port 443]
#
# Environment overrides:
#   XRAY_CONFIG, FALLBACK_DEST, FALLBACK_PORT
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[add-xray-fallback]\033[0m $*"; }
warn() { echo -e "\033[1;33m[add-xray-fallback]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[add-xray-fallback]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
XRAY_CONFIG="${XRAY_CONFIG:-}"
FALLBACK_DEST="${FALLBACK_DEST:-127.0.0.1:8444}"
FALLBACK_PORT="${FALLBACK_PORT:-443}"

# ── Parse args ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --config) XRAY_CONFIG="${2:-}"; shift 2 ;;
    --dest)   FALLBACK_DEST="${2:-}"; shift 2 ;;
    --port)   FALLBACK_PORT="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: add-xray-fallback.sh --config <path> [--dest 127.0.0.1:8444] [--port 443]

Adds a fallback to the Xray 443 inbound by editing the config file directly.

Options:
  --config <path>  Path to the Xray config.json (required)
  --dest <addr>    Fallback destination (default 127.0.0.1:8444)
  --port <p>       Port of the inbound to modify (default 443)
EOF
      exit 0 ;;
    *)
      err "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$XRAY_CONFIG" ]; then
  err "Xray config path is required. Pass --config or set XRAY_CONFIG."
  exit 1
fi
if [ ! -f "$XRAY_CONFIG" ]; then
  err "Config file not found: $XRAY_CONFIG"
  exit 1
fi

# ── 1. Backup ───────────────────────────────────────────────────────────────
BACKUP="${XRAY_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
cp "$XRAY_CONFIG" "$BACKUP"
log "Backed up config to $BACKUP"

# ── 2. Add the fallback via Node (robust JSON handling) ─────────────────────
log "Adding fallback to inbound on port $FALLBACK_PORT -> $FALLBACK_DEST"
node -e "
const fs = require('fs');
const p = '$XRAY_CONFIG';
const dest = '$FALLBACK_DEST';
const port = Number('$FALLBACK_PORT');
const cfg = JSON.parse(fs.readFileSync(p, 'utf-8'));

const inbounds = Array.isArray(cfg.inbounds) ? cfg.inbounds : [];
let target = null;
for (const ib of inbounds) {
  if (Number(ib.port) === port) { target = ib; break; }
}
if (!target) {
  console.error('No inbound found on port ' + port);
  process.exit(1);
}

// Build the fallbacks array
const fb = [{ dest: dest, xver: 1 }];

// For ws/tls inbounds, fallbacks go inside tlsSettings
if (target.streamSettings && target.streamSettings.tlsSettings) {
  target.streamSettings.tlsSettings.fallbacks = fb;
  console.log('Added fallbacks to tlsSettings');
}
// For reality inbounds, fallbacks go inside realitySettings
else if (target.streamSettings && target.streamSettings.realitySettings) {
  target.streamSettings.realitySettings.fallbacks = fb;
  console.log('Added fallbacks to realitySettings');
}
// Fallback: add at streamSettings level
else if (target.streamSettings) {
  target.streamSettings.fallbacks = fb;
  console.log('Added fallbacks to streamSettings');
} else {
  console.error('No streamSettings found on the inbound');
  process.exit(1);
}

fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
console.log('Config updated.');
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
✅ Done. Fallback added to the port $FALLBACK_PORT inbound.

   Non-VPN traffic to port $FALLBACK_PORT now forwards to $FALLBACK_DEST
   (nginx), which serves the key server / portal.

   Backup saved at: $BACKUP
   To revert:       cp $BACKUP $XRAY_CONFIG && systemctl restart xray

Verify:
   curl -k https://key.vchannel.dpdns.org/sub/<TOKEN>?key=<KEY>
================================================================================
EOF
log "Done."