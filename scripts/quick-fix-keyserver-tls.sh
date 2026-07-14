#!/usr/bin/env bash
set -euo pipefail

POST_RENEW_HOOK="/usr/local/bin/cmp-post-renew.sh"
DEFAULT_KEY_PORT=8088
DEFAULT_APP_PORT=3001

log() {
  echo "[keyserver-tls-fix] $*"
}

warn() {
  echo "[keyserver-tls-fix] $*" >&2
}

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  warn "Run this script as root"
  exit 1
fi

DOMAIN=""
INSTALL_HOOK_ONLY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --install-hook-only)
      INSTALL_HOOK_ONLY=true
      shift
      ;;
    -h|--help)
      cat <<'EOF'
Usage: quick-fix-keyserver-tls.sh [--domain example.com] [--install-hook-only]

Fixes the keyserver nginx vhost, installs a certbot deploy hook, and reloads nginx.
EOF
      exit 0
      ;;
    *)
      if [ -z "$DOMAIN" ]; then
        DOMAIN="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$DOMAIN" ] && [ -f /srv/cmp/.env ]; then
  # shellcheck disable=SC1091
  source /srv/cmp/.env 2>/dev/null || true
  DOMAIN="${DOMAIN_NAME:-${DOMAIN:-}}"
fi

if [ -z "$DOMAIN" ] && [ -f /etc/nginx/sites-available/cmp ]; then
  DOMAIN=$(grep -oE 'server_name[[:space:]]+[^;]+' /etc/nginx/sites-available/cmp | head -1 | awk '{print $2}' | xargs || true)
fi

if [ -z "$DOMAIN" ] && [ -f /etc/nginx/sites-enabled/cmp ]; then
  DOMAIN=$(grep -oE 'server_name[[:space:]]+[^;]+' /etc/nginx/sites-enabled/cmp | head -1 | awk '{print $2}' | xargs || true)
fi

if [ -z "$DOMAIN" ]; then
  warn "Could not detect a domain. Pass one with --domain or run on the server with nginx already configured."
  exit 1
fi

install_post_renew_hook() {
  cat > "$POST_RENEW_HOOK" <<'EOF'
#!/usr/bin/env bash
set -e
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || systemctl restart nginx || true
fi
EOF
  chmod +x "$POST_RENEW_HOOK"

  local renewal_conf="/etc/letsencrypt/renewal/${DOMAIN}.conf"
  if [ -f "$renewal_conf" ] && ! grep -q "deploy_hook = $POST_RENEW_HOOK" "$renewal_conf"; then
    {
      echo ""
      echo "# Reload nginx after certificate renewal"
      echo "deploy_hook = $POST_RENEW_HOOK"
    } >> "$renewal_conf"
    log "Added deploy_hook to ${renewal_conf}"
  fi
}

fix_keyserver_vhost() {
  if [[ "$DOMAIN" != key.* ]]; then
    log "Domain does not look like a keyserver host; skipping proxy port rewrite"
    return 0
  fi

  local candidates=(
    "/etc/nginx/sites-available/cmp"
    "/etc/nginx/sites-enabled/cmp"
    "/etc/nginx/sites-available/cmp-${DOMAIN}.conf"
    "/etc/nginx/sites-enabled/cmp-${DOMAIN}.conf"
  )

  local file=""
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ] && grep -q "server_name[[:space:]]\+${DOMAIN}" "$candidate"; then
      file="$candidate"
      break
    fi
  done

  if [ -z "$file" ]; then
    warn "No nginx vhost found for ${DOMAIN}"
    return 0
  fi

  if grep -q "proxy_pass http://127.0.0.1:${DEFAULT_APP_PORT};" "$file"; then
    local backup="${file}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$file" "$backup"
    sed -i "s#proxy_pass http://127.0.0.1:${DEFAULT_APP_PORT};#proxy_pass http://127.0.0.1:${DEFAULT_KEY_PORT};#g" "$file"
    log "Updated ${file} to proxy ${DOMAIN} to ${DEFAULT_KEY_PORT} (backup: ${backup})"
  else
    log "Proxy target already looks correct in ${file}"
  fi
}

install_post_renew_hook

if [ "$INSTALL_HOOK_ONLY" = false ]; then
  fix_keyserver_vhost
fi

if command -v nginx >/dev/null 2>&1; then
  if nginx -t; then
    systemctl reload nginx || systemctl restart nginx || true
  else
    systemctl restart nginx || true
  fi
  log "nginx reloaded"
fi

log "Done"