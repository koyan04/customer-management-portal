#!/usr/bin/env bash
# =============================================================================
# restore-old-links.sh — Restore old subscription links so existing clients
#                        keep working without re-distributing new URLs.
#
# Old links look like:
#   https://key.vchannel.dpdns.org/sub/<TOKEN>?key=<SECRET_KEY>
#
# For them to work again, three things must be true:
#   1. The key server secret key must match the OLD key in the links.
#   2. The OLD token must map to the config file it should serve.
#   3. The URL must reach the key server (port 443 via Xray fallback, or a
#      custom port).
#
# This script restores the secret key and token mapping. It does NOT touch
# Xray — you must add the fallback in the 3x-ui panel separately (see README).
#
# Usage:
#   sudo ./restore-old-links.sh \
#       --secret-key 88f24d617ed0fa519f02762c600ea8f7 \
#       --token 403321bd3156bd36d6042dd154e8519f \
#       --file vchannel-config-admin-test.yaml \
#       [--public-domain https://key.vchannel.dpdns.org:8444]
#
# Environment overrides:
#   OLD_SECRET_KEY, OLD_TOKEN, CONFIG_FILE, PUBLIC_DOMAIN
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[restore-old-links]\033[0m $*"; }
warn() { echo -e "\033[1;33m[restore-old-links]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[restore-old-links]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
APP_DIR="${APP_DIR:-/srv/cmp}"
BACKEND_DIR="$APP_DIR/backend"
KEYSERVER_CONFIG="$BACKEND_DIR/data/keyserver.json"
TOKEN_MAP="$BACKEND_DIR/data/token_map.json"
CONFIG_DIR="${CONFIG_DIR:-$APP_DIR/configs}"

OLD_SECRET_KEY="${OLD_SECRET_KEY:-}"
OLD_TOKEN="${OLD_TOKEN:-}"
CONFIG_FILE="${CONFIG_FILE:-}"
PUBLIC_DOMAIN="${PUBLIC_DOMAIN:-}"

# ── Parse args ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --secret-key)     OLD_SECRET_KEY="${2:-}"; shift 2 ;;
    --token)          OLD_TOKEN="${2:-}";      shift 2 ;;
    --file)           CONFIG_FILE="${2:-}";    shift 2 ;;
    --public-domain)  PUBLIC_DOMAIN="${2:-}";  shift 2 ;;
    -h|--help)
      cat <<'EOF'
Usage: restore-old-links.sh --secret-key <key> --token <token> --file <file>

Restores the old key server secret key and token mapping so existing
subscription links keep working.

Options:
  --secret-key <k>     The OLD secret key from the links (required)
  --token <t>          The OLD token from the links (required)
  --file <f>           Config file the token should serve (required)
  --public-domain <d>  publicDomain to set (e.g. https://key.example.com:8444)
EOF
      exit 0 ;;
    *)
      err "Unknown argument: $1"; exit 1 ;;
  esac
done

if [ -z "$OLD_SECRET_KEY" ] || [ -z "$OLD_TOKEN" ] || [ -z "$CONFIG_FILE" ]; then
  err "Missing required args. Use --secret-key, --token, --file."
  exit 1
fi

if [ ! -f "$KEYSERVER_CONFIG" ]; then
  err "keyserver config not found at $KEYSERVER_CONFIG"
  exit 1
fi

# ── 1. Restore the secret key ───────────────────────────────────────────────
log "Restoring secret key in $KEYSERVER_CONFIG"
node -e "
const fs = require('fs');
const p = '$KEYSERVER_CONFIG';
const c = JSON.parse(fs.readFileSync(p, 'utf-8'));
c.secretKey = '$OLD_SECRET_KEY';
if ('$PUBLIC_DOMAIN') c.publicDomain = '$PUBLIC_DOMAIN';
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('secretKey ->', c.secretKey);
if (c.publicDomain) console.log('publicDomain ->', c.publicDomain);
"

# ── 2. Restore the token mapping ────────────────────────────────────────────
log "Restoring token mapping in $TOKEN_MAP"
node -e "
const fs = require('fs');
const p = '$TOKEN_MAP';
let m = { byToken: {}, byFile: {} };
try { m = JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) {}
m.byToken = m.byToken || {};
m.byFile = m.byFile || {};
m.byToken['$OLD_TOKEN'] = '$CONFIG_FILE';
m.byFile['$CONFIG_FILE'] = '$OLD_TOKEN';
fs.writeFileSync(p, JSON.stringify(m, null, 2));
console.log('token ->', '$OLD_TOKEN', '=>', '$CONFIG_FILE');
"

# ── 3. Verify the config file exists ────────────────────────────────────────
if [ -f "$CONFIG_DIR/$CONFIG_FILE" ]; then
  log "Config file exists: $CONFIG_DIR/$CONFIG_FILE"
else
  warn "Config file NOT found at $CONFIG_DIR/$CONFIG_FILE"
  warn "The token will map to it, but the file must exist for the link to work."
fi

# ── 4. Restart backend to apply ─────────────────────────────────────────────
log "Restarting backend to apply changes..."
systemctl restart cmp-backend 2>/dev/null || true

cat <<EOF

================================================================================
✅ Done. Old links should now work IF the URL reaches the key server.

Old link format:
   https://key.vchannel.dpdns.org/sub/$OLD_TOKEN?key=$OLD_SECRET_KEY

IMPORTANT — the URL must reach the key server on port 8088. Two cases:

1) If the link has NO port (port 443, owned by Xray):
   You MUST add a fallback in the 3x-ui panel to forward browser traffic to
   nginx on 127.0.0.1:8444. See README "Serving the portal on port 443
   alongside Xray". Without this, port 443 goes to Xray, not the key server.

2) If the link uses a custom port (e.g. :8444):
   https://key.vchannel.dpdns.org:8444/sub/$OLD_TOKEN?key=$OLD_SECRET_KEY
   This works now (nginx on 8444 -> key server :8088).

Verify:
   curl -k "https://key.vchannel.dpdns.org:8444/sub/$OLD_TOKEN?key=$OLD_SECRET_KEY"
================================================================================
EOF
log "Done."