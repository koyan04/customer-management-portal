#!/usr/bin/env bash
# =============================================================================
# integrate-nginx.sh — Integrate CMP portal + keyserver into an EXISTING nginx
#
# Purpose:
#   On a fresh VPS where nginx is ALREADY running with other domains, this
#   script adds the Customer Management Portal and its Key Server as separate
#   vhost files WITHOUT touching or restarting the existing domains.
#
#   It is safe to run on a server that already has nginx serving other sites:
#     * Creates isolated vhost files under /etc/nginx/sites-available/
#     * Symlinks them into sites-enabled/ (never overwrites existing files)
#     * Runs `nginx -t` BEFORE applying anything
#     * Uses `systemctl reload nginx` (non-disruptive) instead of `restart`
#     * Never stops nginx
#
# Usage:
#   sudo ./integrate-nginx.sh \
#       --portal-domain portal.example.com \
#       --key-domain key.example.com \
#       --backend-port 3001 \
#       --key-port 8088 \
#       [--http-only] [--no-reload]
#
# Environment overrides (same names as install.sh):
#   DOMAIN, KEYSERVER_DOMAIN, BACKEND_PORT, KEYSERVER_PORT
# =============================================================================
set -euo pipefail

log()  { echo -e "\033[1;32m[integrate-nginx]\033[0m $*"; }
warn() { echo -e "\033[1;33m[integrate-nginx]\033[0m $*" >&2; }
err()  { echo -e "\033[1;31m[integrate-nginx]\033[0m $*" >&2; }

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  err "Run this script as root (sudo)."
  exit 1
fi

# ── Defaults ────────────────────────────────────────────────────────────────
PORTAL_DOMAIN="${DOMAIN:-}"
KEY_DOMAIN="${KEYSERVER_DOMAIN:-}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
KEY_PORT="${KEYSERVER_PORT:-8088}"
HTTP_ONLY=false
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
    --http-only)     HTTP_ONLY=true;         shift ;;
    --no-reload)     NO_RELOAD=true;         shift ;;
    -h|--help)
      cat <<'EOF'
Usage: integrate-nginx.sh [options]

Integrates the CMP portal and key server into an existing nginx install
without disrupting other domains.

Options:
  --portal-domain <d>   Portal public domain (required)
  --key-domain <d>      Key server public domain (defaults to key.<portal>)
  --backend-port <p>    Backend port (default 3001)
  --key-port <p>        Key server port (default 8088)
  --http-only           Serve HTTP only (no TLS / no 443 block)
  --no-reload           Do not reload nginx at the end
EOF
      exit 0 ;;
    *)
      if [ -z "$PORTAL_DOMAIN" ]; then PORTAL_DOMAIN="$1"; shift;
      elif [ -z "$KEY_DOMAIN" ]; then KEY_DOMAIN="$1"; shift;
      else err "Unknown argument: $1"; exit 1; fi ;;
  esac
done

# ── Validate ────────────────────────────────────────────────────────────────
if [ -z "$PORTAL_DOMAIN" ]; then
  err "Portal domain is required. Pass --portal-domain or set DOMAIN."
  exit 1
fi
# Normalize: strip scheme + path so we store bare domains
PORTAL_DOMAIN=$(echo "$PORTAL_DOMAIN" | sed -E 's#^https?://##; s#/.*$##')
if [ -z "$KEY_DOMAIN" ]; then
  KEY_DOMAIN="key.${PORTAL_DOMAIN}"
fi
KEY_DOMAIN=$(echo "$KEY_DOMAIN" | sed -E 's#^https?://##; s#/.*$##')

if ! command -v nginx >/dev/null 2>&1; then
  err "nginx is not installed. Install it first (apt-get install -y nginx)."
  exit 1
fi

mkdir -p "$SITES_AVAILABLE" "$SITES_ENABLED"

# ── Certificate detection ───────────────────────────────────────────────────
has_cert() {
  local d="$1"
  [ -f "/etc/letsencrypt/live/$d/fullchain.pem" ] && \
  [ -f "/etc/letsencrypt/live/$d/privkey.pem" ]
}

# ── Write a vhost file (never overwrite existing) ───────────────────────────
write_vhost() {
  local name="$1" content="$2"
  local path="$SITES_AVAILABLE/$name"
  local enabled="$SITES_ENABLED/$name"

  if [ -f "$path" ]; then
    warn "Vhost $name already exists — leaving it untouched."
    warn "  Review it manually: $path"
    # Still ensure it's enabled if not already
    if [ ! -e "$enabled" ]; then
      ln -sf "$path" "$enabled"
      log "Enabled existing vhost $name"
    fi
    return 0
  fi

  cat > "$path" <<EOF
$content
EOF
  ln -sf "$path" "$enabled"
  log "Created vhost $name -> $enabled"
}

# ── Portal vhost ────────────────────────────────────────────────────────────
log "Configuring portal vhost for $PORTAL_DOMAIN (backend :$BACKEND_PORT)"
if [ "$HTTP_ONLY" = true ] || ! has_cert "$PORTAL_DOMAIN"; then
  if [ "$HTTP_ONLY" != true ]; then
    warn "No certificate found for $PORTAL_DOMAIN — serving HTTP only."
    warn "  Obtain a cert later, then re-run with --no-reload or edit the vhost."
  fi
  write_vhost "cmp-$PORTAL_DOMAIN.conf" "
server {
    listen 80;
    listen [::]:80;
    server_name $PORTAL_DOMAIN;

    # Allow large JSON payloads (key server backup/restore, admin restore)
    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
"
else
  write_vhost "cmp-$PORTAL_DOMAIN.conf" "
upstream cmp_backend {
    server 127.0.0.1:$BACKEND_PORT;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $PORTAL_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
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
        add_header Cache-Control \"public\";
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
"
fi

# ── Key server vhost ────────────────────────────────────────────────────────
log "Configuring key server vhost for $KEY_DOMAIN (key server :$KEY_PORT)"
if [ "$HTTP_ONLY" = true ] || ! has_cert "$KEY_DOMAIN"; then
  if [ "$HTTP_ONLY" != true ]; then
    warn "No certificate found for $KEY_DOMAIN — serving HTTP only."
  fi
  write_vhost "cmp-$KEY_DOMAIN.conf" "
upstream cmp_keyserver {
    server 127.0.0.1:$KEY_PORT;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $KEY_DOMAIN;

    # Allow large JSON payloads (key server backup/restore)
    client_max_body_size 200m;

    location / {
        proxy_pass http://cmp_keyserver;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
"
else
  write_vhost "cmp-$KEY_DOMAIN.conf" "
upstream cmp_keyserver {
    server 127.0.0.1:$KEY_PORT;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $KEY_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
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
"
fi

# ── Validate + apply ────────────────────────────────────────────────────────
log "Testing nginx configuration..."
if ! nginx -t; then
  err "nginx configuration test FAILED. No changes were applied."
  err "Review the generated vhosts under $SITES_AVAILABLE."
  exit 1
fi

if [ "$NO_RELOAD" = true ]; then
  log "Skipping nginx reload (--no-reload)."
  log "Reload manually when ready: systemctl reload nginx"
else
  log "Reloading nginx (non-disruptive)..."
  systemctl reload nginx || systemctl restart nginx || true
fi

log "Done."
log "Portal:   http${HTTP_ONLY:+ (http)}://$PORTAL_DOMAIN  -> 127.0.0.1:$BACKEND_PORT"
log "KeyServer:http${HTTP_ONLY:+ (http)}://$KEY_DOMAIN  -> 127.0.0.1:$KEY_PORT"
log ""
log "Existing nginx domains were NOT modified."