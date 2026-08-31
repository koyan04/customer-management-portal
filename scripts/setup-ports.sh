#!/usr/bin/env bash
# =============================================================================
# setup-ports.sh — Serve the CMP portal (:3001) and key server (:8088) over
#                  HTTPS with valid certificates, WITHOUT touching Xray.
#
# Why this exists:
#   On a VPN server, Xray owns ports 80/443. nginx cannot bind to them. The
#   simplest reliable approach is to run nginx on a FREE port (e.g. 8444) and
#   proxy BOTH the portal and the key server there with valid Let's Encrypt
#   certificates:
#
#     https://portal.example.com:8444  -> nginx -> backend :3001
#     https://key.example.com:8444     -> nginx -> key server :8088
#
#   Xray is completely untouched. Both services get valid certs.
#
# What this script does:
#   1. Obtains Let's Encrypt certificates for the portal and key domains.
#   2. Creates nginx vhosts on a free port (auto-detected) that terminate TLS
#      and proxy to :3001 and :8088.
#   3. Reloads nginx (non-disruptive).
#
# Usage:
#   sudo ./setup-ports.sh \
#       --portal-domain ynparadise.dpdns.org \
#       --key-domain key.vchannel.dpdns.org \
#       [--backend-port 3001] [--key-port 8088] [--listen-port 8444]
#
# Environment overrides:
#   DOMAIN, KEYSERVER_DOMAIN, BACKEND_PORT, KEYSERVER_PORT, LE_EMAIL
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[setup-ports]\033[0m $*"; }
warn() { echo -e "\033[1;33m[setup-ports]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[setup-ports]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
PORTAL_DOMAIN="${DOMAIN:-}"
KEY_DOMAIN="${KEYSERVER_DOMAIN:-}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
KEY_PORT="${KEYSERVER_PORT:-8088}"
LISTEN_PORT="${LISTEN_PORT:-}"          # auto-detected if empty
LE_EMAIL="${LE_EMAIL:-admin@${PORTAL_DOMAIN:-example.com}}"
NO_RELOAD=false

NGINX_ROOT="${NGINX_ROOT:-/etc/nginx}"
SITES_AVAILABLE="$NGINX_ROOT/sites-available"
SITES_ENABLED="$NGINX_ROOT/sites-enabled"

# ── Parse args ──────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --portal-domain) PORTAL_DOMAIN="${2:-}"; shift 2 ;;
    --key-domain)    KEY_DOMAIN="${2:-}";    shift 2 ;;
    --backend-port)  BACKEND_PORT="${2:-}";  shift 2 ;;
    --key-port)      KEY_PORT="${2:-}";      shift 2 ;;
    --listen-port)   LISTEN_PORT="${2:-}";   shift 2 ;;
    --no-reload)     NO_RELOAD=true; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: setup-ports.sh --portal-domain <d> --key-domain <d> [options]

Serves the portal (:3001) and key server (:8088) over HTTPS with valid
certificates on a free nginx port, without touching Xray.

Options:
  --portal-domain <d>  Portal domain (required)
  --key-domain <d>     Key server domain (required)
  --backend-port <p>   Backend port (default 3001)
  --key-port <p>       Key server port (default 8088)
  --listen-port <p>    nginx listen port (auto-detected if omitted)
  --no-reload          Do not reload nginx at the end
EOF
      exit 0 ;;
    *)
      if [ -z "$PORTAL_DOMAIN" ]; then PORTAL_DOMAIN="$1"; shift;
      elif [ -z "$KEY_DOMAIN" ]; then KEY_DOMAIN="$1"; shift;
      else err "Unknown argument: $1"; exit 1; fi ;;
  esac
done

if [ -z "$PORTAL_DOMAIN" ]; then
  err "Portal domain is required. Pass --portal-domain or set DOMAIN."
  exit 1
fi
if [ -z "$KEY_DOMAIN" ]; then
  KEY_DOMAIN="key.${PORTAL_DOMAIN}"
fi
PORTAL_DOMAIN=$(echo "$PORTAL_DOMAIN" | sed -E 's#^https?://##; s#/.*$##')
KEY_DOMAIN=$(echo "$KEY_DOMAIN" | sed -E 's#^https?://##; s#/.*$##')

if ! command -v nginx >/dev/null 2>&1; then
  err "nginx is not installed. Install it first (apt-get install -y nginx)."
  exit 1
fi
if ! command -v certbot >/dev/null 2>&1; then
  err "certbot is not installed. Install it first (apt-get install -y certbot)."
  exit 1
fi

# ── Auto-detect a free port for nginx ───────────────────────────────────────
if [ -z "$LISTEN_PORT" ]; then
  for p in 8444 8445 9443 10443 11443 12443; do
    if ! ss -ltn 2>/dev/null | grep -q ":$p "; then
      LISTEN_PORT="$p"
      break
    fi
  done
  if [ -z "$LISTEN_PORT" ]; then
    err "Could not find a free port for nginx. Pass --listen-port explicitly."
    exit 1
  fi
  log "Auto-selected free port $LISTEN_PORT for nginx."
fi

mkdir -p "$SITES_AVAILABLE" "$SITES_ENABLED"

# ── Certificate helper ──────────────────────────────────────────────────────
ensure_cert() {
  local domain="$1"
  local cert_dir="/etc/letsencrypt/live/$domain"
  if [ -f "$cert_dir/fullchain.pem" ] && [ -f "$cert_dir/privkey.pem" ]; then
    log "Certificate already present for $domain."
    return 0
  fi
  log "Obtaining certificate for $domain (HTTP-01)..."
  # Try standalone if port 80 is free, else webroot via a temporary listener.
  if ! ss -ltn 2>/dev/null | grep -q ':80 '; then
    certbot certonly --standalone --non-interactive --agree-tos \
      --email "$LE_EMAIL" -d "$domain" --preferred-challenges http \
      && return 0
  fi
  # Webroot fallback (requires nginx to serve /.well-known on port 80)
  mkdir -p /var/www/letsencrypt
  cat > "$SITES_AVAILABLE/cmp-acme-$domain.conf" <<EOF
server {
    listen 127.0.0.1:80;
    server_name $domain;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
EOF
  ln -sf "$SITES_AVAILABLE/cmp-acme-$domain.conf" "$SITES_ENABLED/cmp-acme-$domain.conf"
  nginx -t && systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
  certbot certonly --webroot -w /var/www/letsencrypt --non-interactive --agree-tos \
    --email "$LE_EMAIL" -d "$domain" --preferred-challenges http \
    || warn "Webroot issuance failed for $domain. Check DNS + port 80 reachability."
  rm -f "$SITES_ENABLED/cmp-acme-$domain.conf" "$SITES_AVAILABLE/cmp-acme-$domain.conf"
  [ -f "$cert_dir/fullchain.pem" ] && [ -f "$cert_dir/privkey.pem" ]
}

# ── 1. Obtain certificates ──────────────────────────────────────────────────
ensure_cert "$PORTAL_DOMAIN" || { err "No cert for $PORTAL_DOMAIN. Aborting."; exit 1; }
ensure_cert "$KEY_DOMAIN"    || { err "No cert for $KEY_DOMAIN. Aborting."; exit 1; }

# ── 2. Create nginx vhosts on the free port ─────────────────────────────────
# Listen on all interfaces so external browsers can reach the portal.
# (Xray owns 80/443; this free port is dedicated to nginx.)
LISTEN_ADDR="${LISTEN_ADDR:-0.0.0.0}"

# Portal vhost
PCONF="$SITES_AVAILABLE/cmp-$PORTAL_DOMAIN.conf"
log "Creating portal vhost on $LISTEN_ADDR:$LISTEN_PORT (proxying to :$BACKEND_PORT)"
cat > "$PCONF" <<EOF
upstream cmp_backend {
    server 127.0.0.1:$BACKEND_PORT;
    keepalive 32;
}

server {
    listen $LISTEN_ADDR:$LISTEN_PORT ssl http2;
    server_name $PORTAL_DOMAIN;

    # Allow large JSON payloads (key server backup/restore, admin restore)
    client_max_body_size 200m;

    ssl_certificate /etc/letsencrypt/live/$PORTAL_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$PORTAL_DOMAIN/privkey.pem;
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
ln -sf "$PCONF" "$SITES_ENABLED/cmp-$PORTAL_DOMAIN.conf"

# Key server vhost
KCONF="$SITES_AVAILABLE/cmp-$KEY_DOMAIN.conf"
log "Creating key server vhost on $LISTEN_ADDR:$LISTEN_PORT (proxying to :$KEY_PORT)"
cat > "$KCONF" <<EOF
upstream cmp_keyserver {
    server 127.0.0.1:$KEY_PORT;
    keepalive 32;
}

server {
    listen $LISTEN_ADDR:$LISTEN_PORT ssl http2;
    server_name $KEY_DOMAIN;

    # Allow large JSON payloads (key server backup/restore)
    client_max_body_size 200m;

    ssl_certificate /etc/letsencrypt/live/$KEY_DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$KEY_DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://cmp_keyserver;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf "$KCONF" "$SITES_ENABLED/cmp-$KEY_DOMAIN.conf"

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

cat <<EOF

================================================================================
✅ Done. Both services are served over HTTPS with valid certificates on port
   $LISTEN_PORT (Xray untouched):

   Portal:    https://$PORTAL_DOMAIN:$LISTEN_PORT  -> backend :$BACKEND_PORT
   KeyServer: https://$KEY_DOMAIN:$LISTEN_PORT     -> key server :$KEY_PORT

   (If you prefer no port in the URL, you would need Xray fallback on 443 —
    but this setup avoids touching Xray entirely.)

Verify (from the server):
   curl -k https://127.0.0.1:$LISTEN_PORT/ -H "Host: $PORTAL_DOMAIN"
   curl -k https://127.0.0.1:$LISTEN_PORT/health -H "Host: $KEY_DOMAIN"

Verify (from the internet / a browser):
   https://$PORTAL_DOMAIN:$LISTEN_PORT/
   https://$KEY_DOMAIN:$LISTEN_PORT/health

   IMPORTANT: Ensure the firewall allows inbound TCP on port $LISTEN_PORT:
     sudo ufw allow $LISTEN_PORT/tcp
================================================================================
EOF
log "Done."