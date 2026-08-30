#!/usr/bin/env bash
# =============================================================================
# setup-portal-443.sh — Serve the CMP portal on https://DOMAIN/ (port 443)
#                        alongside Xray, WITHOUT disturbing Xray.
#
# Why this exists:
#   On a VPN server, Xray owns ports 80/443 for VPN traffic. nginx cannot bind
#   to 443 directly. The standard solution is Xray's `fallback` feature:
#
#     Browser -> https://DOMAIN (443)
#        -> Xray (owns 443)
#           -> VPN client?  -> handled by Xray (untouched)
#           -> Browser?     -> fallback -> nginx 127.0.0.1:8443 -> backend :3001
#
#   Xray forwards the RAW connection to nginx on a non-conflicting port (8443).
#   nginx does its own TLS termination using the portal's Let's Encrypt cert.
#
# What this script does:
#   1. Obtains a Let's Encrypt certificate for the portal domain (HTTP-01 via
#      a temporary nginx listener on port 80, or standalone if port 80 is free).
#   2. Creates an nginx vhost listening on 127.0.0.1:8443 (NOT 443) that
#      terminates TLS and proxies to the backend.
#   3. Prints the exact Xray `fallback` block you must add to your Xray config
#      so Xray forwards browser traffic to nginx:8443.
#   4. Reloads nginx (non-disruptive).
#
# Usage:
#   sudo ./setup-portal-443.sh --domain ynparadise.dpdns.org [--backend-port 3001]
#
# Environment overrides:
#   DOMAIN, BACKEND_PORT, LE_EMAIL
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[setup-portal-443]\033[0m $*"; }
warn() { echo -e "\033[1;33m[setup-portal-443]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[setup-portal-443]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
DOMAIN="${DOMAIN:-}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
NGINX_LISTEN_PORT="${NGINX_LISTEN_PORT:-}"       # auto-detected if empty
LE_EMAIL="${LE_EMAIL:-admin@${DOMAIN:-example.com}}"
NO_RELOAD=false

NGINX_ROOT="${NGINX_ROOT:-/etc/nginx}"
SITES_AVAILABLE="$NGINX_ROOT/sites-available"
SITES_ENABLED="$NGINX_ROOT/sites-enabled"

# ── Parse args ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --domain)        DOMAIN="${2:-}"; shift 2 ;;
    --backend-port)  BACKEND_PORT="${2:-}"; shift 2 ;;
    --listen-port)   NGINX_LISTEN_PORT="${2:-}"; shift 2 ;;
    --no-reload)     NO_RELOAD=true; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: setup-portal-443.sh --domain example.com [options]

Serves the CMP portal on https://example.com/ (port 443) alongside Xray
using Xray's fallback feature. nginx listens on 127.0.0.1:<port> (not 443).

Options:
  --domain <d>        Portal domain (required)
  --backend-port <p>  Backend port (default 3001)
  --listen-port <p>   nginx listen port (auto-detected if omitted)
  --no-reload         Do not reload nginx at the end
EOF
      exit 0 ;;
    *)
      if [ -z "$DOMAIN" ]; then DOMAIN="$1"; shift;
      else err "Unknown argument: $1"; exit 1; fi ;;
  esac
done

if [ -z "$DOMAIN" ]; then
  err "Domain is required. Pass --domain or set DOMAIN."
  exit 1
fi
DOMAIN=$(echo "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##')

if ! command -v nginx >/dev/null 2>&1; then
  err "nginx is not installed. Install it first (apt-get install -y nginx)."
  exit 1
fi
if ! command -v certbot >/dev/null 2>&1; then
  err "certbot is not installed. Install it first (apt-get install -y certbot)."
  exit 1
fi

# ── Auto-detect a free port for nginx (Xray may own 8443) ───────────────────
if [ -z "$NGINX_LISTEN_PORT" ]; then
  for p in 8443 8444 8445 9443 10443 11443 12443; do
    if ! ss -ltn 2>/dev/null | grep -q ":$p "; then
      NGINX_LISTEN_PORT="$p"
      break
    fi
  done
  if [ -z "$NGINX_LISTEN_PORT" ]; then
    err "Could not find a free port for nginx. Pass --listen-port explicitly."
    exit 1
  fi
  log "Auto-selected free port $NGINX_LISTEN_PORT for nginx."
fi

mkdir -p "$SITES_AVAILABLE" "$SITES_ENABLED"

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
CERT_OK=false
[ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ] && CERT_OK=true

# ── 1. Obtain certificate if missing ────────────────────────────────────────
if [ "$CERT_OK" = false ]; then
  log "No certificate found for $DOMAIN. Obtaining one via HTTP-01..."
  # If port 80 is free, use standalone. Otherwise use a temporary nginx listener.
  if ! ss -ltn 2>/dev/null | grep -q ':80 '; then
    log "Port 80 is free — using certbot standalone."
    certbot certonly --standalone --non-interactive --agree-tos \
      --email "$LE_EMAIL" -d "$DOMAIN" --preferred-challenges http \
      || warn "Standalone issuance failed; will try nginx webroot."
  fi
  if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
    log "Using nginx webroot for HTTP-01 challenge..."
    mkdir -p /var/www/letsencrypt
    # Temporary port-80 vhost for the challenge
    cat > "$SITES_AVAILABLE/cmp-acme-$DOMAIN.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
EOF
    ln -sf "$SITES_AVAILABLE/cmp-acme-$DOMAIN.conf" "$SITES_ENABLED/cmp-acme-$DOMAIN.conf"
    nginx -t && systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
    certbot certonly --webroot -w /var/www/letsencrypt --non-interactive --agree-tos \
      --email "$LE_EMAIL" -d "$DOMAIN" --preferred-challenges http \
      || warn "Webroot issuance failed. Check DNS + port 80 reachability."
    rm -f "$SITES_ENABLED/cmp-acme-$DOMAIN.conf" "$SITES_AVAILABLE/cmp-acme-$DOMAIN.conf"
  fi
  [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ] && CERT_OK=true
fi

if [ "$CERT_OK" = false ]; then
  err "Could not obtain a certificate for $DOMAIN. Aborting."
  err "Ensure DNS resolves here and port 80 is reachable, then re-run."
  exit 1
fi
log "Certificate ready for $DOMAIN."

# ── 2. Create nginx vhost on 127.0.0.1:$NGINX_LISTEN_PORT (NOT 443) ────────
NCONF="$SITES_AVAILABLE/cmp-$DOMAIN.conf"
log "Creating nginx vhost listening on 127.0.0.1:$NGINX_LISTEN_PORT (proxying to :$BACKEND_PORT)"
cat > "$NCONF" <<EOF
upstream cmp_backend {
    server 127.0.0.1:$BACKEND_PORT;
    keepalive 32;
}

# TLS termination on a non-conflicting port (Xray fallback forwards here)
server {
    listen 127.0.0.1:$NGINX_LISTEN_PORT ssl http2;
    server_name $DOMAIN;

    # Allow large JSON payloads (key server backup/restore, admin restore)
    client_max_body_size 200m;

    ssl_certificate $CERT_DIR/fullchain.pem;
    ssl_certificate_key $CERT_DIR/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location /uploads/ {
        proxy_pass http://cmp_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        expires 1h;
        add_header Cache-Control "public";
    }

    location / {
        proxy_pass http://cmp_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf "$NCONF" "$SITES_ENABLED/cmp-$DOMAIN.conf"

# ── 3. Validate + reload ────────────────────────────────────────────────────
log "Testing nginx configuration..."
if ! nginx -t; then
  err "nginx configuration test FAILED. No changes applied."
  exit 1
fi
if [ "$NO_RELOAD" = true ]; then
  log "Skipping nginx reload (--no-reload)."
else
  log "Reloading nginx (non-disruptive)..."
  systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
fi

# ── 4. Print the Xray fallback block ────────────────────────────────────────
cat <<EOF

================================================================================
✅ nginx is ready. Portal will be served on https://$DOMAIN/ once Xray forwards
   browser traffic to nginx on 127.0.0.1:$NGINX_LISTEN_PORT.

NEXT STEP — Add this 'fallback' to your Xray config's 443 inbound:

Add to the inbound that listens on 443 (the one with "port": 443), inside its
"streamSettings" -> "realitySettings" (or "tlsSettings"), add a "dest" fallback:

    "fallbacks": [
        {
            "dest": "127.0.0.1:$NGINX_LISTEN_PORT",
            "xver": 1
        }
    ]

Example (REALITY inbound on 443):
    {
      "port": 443,
      "protocol": "vless",
      "settings": { ... },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "ynparadise.dpdns.org:443",
          "serverNames": ["ynparadise.dpdns.org"],
          "privateKey": "...",
          "shortIds": ["..."],
          "fallbacks": [
            { "dest": "127.0.0.1:$NGINX_LISTEN_PORT", "xver": 1 }
          ]
        }
      }
    }

After editing, restart Xray:
    systemctl restart xray

Then test in a browser:  https://$DOMAIN/
================================================================================
EOF
log "Done."