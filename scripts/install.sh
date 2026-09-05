#!/usr/bin/env bash
set -euo pipefail

# Customer Management Portal Installer
# Version: v1.9.13
# Features:
#   - Downloads latest release tarball instead of cloning
#   - Installs Node.js automatically (Debian/Ubuntu) unless CMP_SKIP_NODE_AUTO_INSTALL=1
#   - Builds frontend, runs migrations, seeds admin + sample data
#   - Issues Let's Encrypt certificate: DNS-01 (Cloudflare) or HTTP-01 (standalone) user-selectable (v1.8.0)
#   - Supports multiple domains via CMP_CERT_DOMAINS (comma or space separated)
#   - Skip certificate issuance entirely with CMP_SKIP_CERT=1
#   - Health probe after startup (/api/health) with summary
#   - Integrity self-check if CMP_INSTALL_EXPECTED_SHA256 provided
#   - GUI Update Manager (v1.6.0): in-panel version check + one-click unattended updates via SSE streaming
#   - Update script self-healing: auto-installs prerequisites, retries on vite failure (v1.7.0)
#   - YAML Generator: TUN block, Anti-DPI on by default, proxy-group health tuning (v1.8.15)
#       * tun block always included: enable:true, stack:system, mtu:1400, auto-route:true, auto-detect-interface:true
#       * Anti-DPI panel now enabled by default (was off) — tcp-concurrent, global fingerprint, DoH DNS
#       * ♻️ Auto Switch: tolerance:150, lazy:true added to url-test group
#       * ⚡ Fastest: tolerance:50, lazy:true added to url-test group
#       * 🛡️ Failover: lazy:true added to fallback group
#       * ⚖️ Load Balance / Static Balance: lazy:true added
#   - JSON Generator: Anti-DPI enabled by default (v1.8.15)
#       * antiDPI state default changed false→true; sing-box output now includes fingerprint/DoH always
#   - Docs: comprehensive guide set added (v1.8.15)
#       * YAML_GENERATOR_BOT_INSTRUCTIONS.md — copy-paste system prompt for AI config bot
#       * YAML_GENERATOR_BOT_GUIDE.md — 12-section technical reference for YAML bot
#       * YAML_GENERATOR_USER_GUIDE.md — 14-section human-facing YAML Generator guide
#       * JSON_GENERATOR_BOT_INSTRUCTIONS.md — updated: SS URI format, 3 subscription URLs, domain rules
#       * JSON_GENERATOR_BOT_GUIDE.md — updated: SS prefix, 3-URL table, data_limit_gb metadata
#       * JSON_GENERATOR_USER_GUIDE.md — updated: 3-URL table, /?outline=1&prefix= format
#       * DEVELOPER_GUIDE.md — POST /api/users/transfer fully documented with error table
#   - Fix: manual data limit now saved to subscription metadata (v1.8.14)
#       * saveToServer was not including data_limit_gb in metadata when no user selected
#       * V2Box showed 100 GB regardless of the Data Limit field value
#       * convertNodeToSingbox stores _prefix in sing-box SS outbound when ssPrefix enabled
#       * outboundToURI emits ss://.../?outline=1&prefix=... format (keyserver -> V2Box)
#       * nodeToURI emits same format for .txt subscription export
#       * Sub URL (base64)  — paste into V2Box / V2RayNG 'Add Subscription'
#       * Raw URL (?format=raw) — proxy-only sing-box JSON for V2Box native sing-box sub
#       * V2Ray URL (?format=v2ray) — full V2Ray/Xray JSON for V2RayNG config import
#       * ?format=raw: now serves proxy-only sing-box JSON {"outbounds":[...]} (strips selector/urltest/direct/block)
#         → V2Box/NekoBox can parse as sing-box subscription and show individual selectable nodes
#       * ?format=v2ray: removed Content-Disposition:attachment so URL can be used for config import
#       * default (base64): unchanged — works with all standard V2Ray/V2Box subscription clients
#       * keyserver outboundToURI: VMess now emits fp, alpn, allowInsecure
#       * keyserver outboundToURI: VLESS now emits security=reality, pbk, sid, fp (REALITY nodes)
#       * keyserver outboundToURI: VLESS TLS now emits alpn, allowInsecure
#       * keyserver outboundToURI: Trojan now emits alpn, allowInsecure
#       * buildSingboxTLS: always emit tls.utls.fingerprint (default clientFingerprint) for TLS nodes
#       * xray format (v1.8.5) caused V2Box to treat entire config as 1 "JSON" entry (0 usable nodes)
#       * sing-box outbounds ("type" field) display as individual selectable nodes in V2Box
#       * buildSingboxTLS: REALITY (tls.reality.public_key/short_id + tls.utls.fingerprint)
#       * TLS: utls.fingerprint from clientFingerprint/URI fp; alpn from forceAlpn or node.alpn
#       * allowInsecure → tls.insecure; forceAlpn → tls.alpn (Anti-DPI panel controls)
#       * Hysteria2: tls.alpn:["h3"] + optional utls when anti-DPI enabled
#       * All 5 protocols: Shadowsocks, VMess, VLESS, VLESS+REALITY, Trojan, Hysteria2
#   - Logo persistence across updates: uploads/logos excluded from rsync --delete (v1.8.0)
#   - Logo and avatar files restored after GUI update (belt-and-suspenders, v1.8.4)
#   - Active theme displayed correctly in Settings dropdown (v1.8.0)
#   - Database page fully responsive with proper button layout (v1.8.0)
#   - Telegram bot test uses stored DB token; clear button on token field (v1.8.0)
#   - Telegram bot immediately stops polling when disabled in settings (v1.8.0)
#   - cmp-backend.service uses Restart=always, auto-deployed during updates (v1.8.0)
#   - Copy menu theme support (v1.6.0): per-variant accent colors, light/dark snapshot classes
# Environment Flags (summary):
#   CMP_CHECKOUT_REF=ref|tag|commit         Force download of specific release version
#   CMP_SKIP_NODE_AUTO_INSTALL=1            Require preinstalled Node
#   CMP_INSTALL_EXPECTED_SHA256=<sha>       Verify installer integrity
#   CMP_CERT_DOMAINS="example.com www.example.com"  Additional domains (primary still prompted)
#   CMP_CERT_HTTP_FALLBACK=auto|1|0         HTTP-01 fallback (auto=default, 1=force, 0=disable)
#   CMP_SKIP_CERT=1                         Do not issue certificates
#   CMP_ENABLE_NGINX=1                      Install & configure Nginx reverse proxy for HTTPS (default: prompt)
#   CF_AUTH_MODE=token|key                  Pre-select Cloudflare auth mode
#   CMP_HEALTH_PROBE_RETRIES=10             Health probe attempts (default 6)
#   CMP_HEALTH_PROBE_INTERVAL=2             Seconds between health probes
#   CMP_DNS_PROPAGATION_SECONDS=10          Seconds to wait for DNS TXT propagation (Cloudflare plugin)
#
# Requirements: bash, sudo/root, curl, tar, openssl, systemd, certbot, python3, (python3-certbot-dns-cloudflare for DNS-01)
# Idempotency: safe to re-run; will skip existing assets & reuse prior configuration.

APP_NAME="customer-management-portal"
OWNER="koyan04"
REPO="customer-management-portal"
APP_DIR="/srv/cmp"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"
CF_CREDS_FILE="/root/.cloudflare.ini"
SYSTEMD_DIR="/etc/systemd/system"
BACKEND_SERVICE="cmp-backend.service"
BOT_SERVICE="cmp-telegram-bot.service"
ROOT_ENV="$APP_DIR/.env"

RESET() { [ -t 1 ] && printf '\033[0m'; }
color() { echo -e "\033[1;32m$1\033[0m"; }
warn() { echo -e "\033[1;33m$1\033[0m"; }
err() { echo -e "\033[1;31m$1\033[0m"; }
info() { echo -e "\033[1;36m$1\033[0m"; }
dim()  { echo -e "\033[2m$1\033[0m"; }
divider() { echo -e "\033[1;34m────────────────────────────────────────────────────────\033[0m"; }
banner() { divider; info "$1"; divider; }
section() { echo -e "\033[1;36m▸ $1\033[0m"; }
ok() { echo -e "\033[1;32m ✔ $1\033[0m"; }
skip() { echo -e "\033[2m - $1\033[0m"; }

die() { err "ERROR: $1"; exit 1; }
require_root() { [ "$(id -u)" -eq 0 ] || die "Run as root"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || return 1; }

auto_install_node() {
  if [ "${CMP_SKIP_NODE_AUTO_INSTALL:-}" = "1" ]; then
    die "Missing required command: node (auto-install skipped due to CMP_SKIP_NODE_AUTO_INSTALL=1)"
  fi
  warn "Node.js not found (installing 20.x LTS)."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || die "NodeSource setup failed"
    apt-get install -y nodejs || die "Node.js install failed"
  else
    die "curl missing; cannot auto-install Node.js"
  fi
}

check_deps() {
  local missing=()
  for c in curl tar openssl certbot python3; do
    require_cmd "$c" || missing+=("$c")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    die "Missing required commands: ${missing[*]}"
  fi
  if ! require_cmd node; then
    auto_install_node
  fi
  if ! require_cmd npm; then
    warn "npm not found; attempting to install (usually with nodejs package)."
    apt-get install -y npm || die "npm install failed"
  fi
}

prompt_if_empty() {
  local var="$1" message="$2" secret="${3:-false}" default_val="${4:-}";
  local current="${!var:-}";
  if [ -n "$current" ]; then return; fi
  # Prefer reading from TTY to avoid issues when script is piped via curl | bash
  local tty_in="/dev/tty"
  if [ ! -t 0 ] && [ ! -r "$tty_in" ]; then
    die "Interactive prompt required: $message. Re-run via: curl -fsSL ... -o install.sh && sudo bash install.sh"
  fi
  while true; do
    if [ -n "$default_val" ]; then
      if [ -r "$tty_in" ]; then
        read -r -p "$message [$default_val]: " input < "$tty_in"
      else
        read -r -p "$message [$default_val]: " input
      fi
      input="${input:-$default_val}"
    else
      if [ -r "$tty_in" ]; then
        read -r -p "$message: " input < "$tty_in"
      else
        read -r -p "$message: " input
      fi
    fi
    if [ -n "$input" ]; then
      printf -v $var '%s' "$input"
      break
    fi
  done
}

# ─── Setup ────────────────────────────────────────────────────────────────
banner "Customer Management Portal Installer"
dim "Version: v1.8.15+  |  Will install/update portal + key server"
divider

# Collect inputs
require_root
check_deps

prompt_if_empty DOMAIN "Enter PRIMARY domain name (FQDN)"

# Parse additional domains from CMP_CERT_DOMAINS (optional). Accept comma or space separators.
EXTRA_DOMAINS_RAW="${CMP_CERT_DOMAINS:-}"
EXTRA_DOMAINS=()
if [ -n "$EXTRA_DOMAINS_RAW" ]; then
  # Replace commas with spaces then iterate
  for d in $(echo "$EXTRA_DOMAINS_RAW" | tr ',' ' '); do
    d_trim=$(echo "$d" | xargs)
    [ -n "$d_trim" ] && [ "$d_trim" != "$DOMAIN" ] && EXTRA_DOMAINS+=("$d_trim") || true
  done
fi

# Choose Cloudflare auth mode: token (recommended) or global API key
CF_AUTH_MODE=${CF_AUTH_MODE:-}
if [ -z "${CF_AUTH_MODE}" ]; then
  read -r -p "Cloudflare auth mode (token/key) [token]: " CF_AUTH_MODE
  CF_AUTH_MODE=${CF_AUTH_MODE:-token}
fi
CF_AUTH_MODE=$(echo "$CF_AUTH_MODE" | tr '[:upper:]' '[:lower:]')

if [ "$CF_AUTH_MODE" = "key" ]; then
  prompt_if_empty CF_GLOBAL_KEY "Enter Cloudflare Global API Key" true
  # Cloudflare account email (used with Global API Key)
  prompt_if_empty CF_ACCOUNT_EMAIL "Enter Cloudflare account email" false "${LE_EMAIL:-}"
else
  CF_AUTH_MODE="token"
  prompt_if_empty CF_API_TOKEN "Enter Cloudflare API Token (Zone DNS Edit)" true
fi

prompt_if_empty LE_EMAIL "Enter email for Let's Encrypt notices"
prompt_if_empty BACKEND_PORT "Backend port" false 3001
# Key server: public domain + port (config written to backend/data/keyserver.json)
KEYSERVER_PORT="${KEYSERVER_PORT:-8088}"
KEYSERVER_CONFIG_DIR="${KEYSERVER_CONFIG_DIR:-$APP_DIR/configs}"
prompt_if_empty KEYSERVER_DOMAIN "Key server public domain (e.g. key.example.com) — optional"
if [ -n "$KEYSERVER_DOMAIN" ]; then
  prompt_if_empty KEYSERVER_PORT "Key server port" false 8088
else
  warn "No key server domain provided; key server will be configured but not exposed via a public HTTPS domain."
fi

prompt_if_empty ADMIN_USER "Admin username" false admin
prompt_if_empty ADMIN_PASS "Admin password (will be stored hashed in DB)" true admin123

# Database configuration prompts (application DB creds)
USE_EXISTING_DB=1
if [ -f "$ENV_FILE" ]; then
  if [ -t 0 ] || [ -r "/dev/tty" ]; then
    if [ -r "/dev/tty" ]; then
      read -r -p "Use existing DB settings from $ENV_FILE? [Y/n]: " ans < "/dev/tty" || true
    else
      read -r -p "Use existing DB settings from $ENV_FILE? [Y/n]: " ans || true
    fi
    ans=${ans:-Y}
    case "$(echo "$ans" | tr '[:upper:]' '[:lower:]')" in
      y|yes|1|true) USE_EXISTING_DB=1;;
      *) USE_EXISTING_DB=0;;
    esac
  fi
fi

if [ "$USE_EXISTING_DB" -eq 1 ] && [ -f "$ENV_FILE" ]; then
  APP_DB_HOST=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
  APP_DB_PORT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
  APP_DB_DATABASE=$(grep '^DB_DATABASE=' "$ENV_FILE" | cut -d= -f2-)
  APP_DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
  APP_DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
else
  prompt_if_empty APP_DB_HOST "Database host" false localhost
  prompt_if_empty APP_DB_PORT "Database port" false 5432
  prompt_if_empty APP_DB_DATABASE "Database name" false cmp
  prompt_if_empty APP_DB_USER "Database username" false cmp
  prompt_if_empty APP_DB_PASSWORD "Database user password" true
fi

# Admin access to PostgreSQL to create role/database
DB_ADMIN_MODE=${CMP_DB_ADMIN_MODE:-}
if [ -z "$DB_ADMIN_MODE" ]; then
  if [ -t 0 ] || [ -r "/dev/tty" ]; then
    if [ -r "/dev/tty" ]; then
      read -r -p "Use local postgres superuser via sudo? [Y/n]: " modeAns < "/dev/tty" || true
    else
      read -r -p "Use local postgres superuser via sudo? [Y/n]: " modeAns || true
    fi
    modeAns=${modeAns:-Y}
    case "$(echo "$modeAns" | tr '[:upper:]' '[:lower:]')" in
      y|yes|1|true) DB_ADMIN_MODE="sudo";;
      *) DB_ADMIN_MODE="tcp";;
    esac
  else
    DB_ADMIN_MODE="sudo"
  fi
fi

if [ "$DB_ADMIN_MODE" = "tcp" ]; then
  prompt_if_empty DB_ADMIN_USER "Admin username (PostgreSQL superuser)" false postgres
  prompt_if_empty DB_ADMIN_PASSWORD "Admin password (PostgreSQL)" true
  DB_ADMIN_HOST=${DB_ADMIN_HOST:-$APP_DB_HOST}
  DB_ADMIN_PORT=${DB_ADMIN_PORT:-$APP_DB_PORT}
fi

# Ask whether to set up Nginx unless overridden via env (robust, works when piped)
if [ -z "${CMP_ENABLE_NGINX:-}" ]; then
  # Prefer interactive prompt when a TTY is available
  if [ -t 0 ] || [ -r "/dev/tty" ]; then
    if [ -r "/dev/tty" ]; then
      read -r -p "Set up Nginx reverse proxy for HTTPS? [Y/n]: " CMP_ENABLE_NGINX < "/dev/tty" || true
    else
      read -r -p "Set up Nginx reverse proxy for HTTPS? [Y/n]: " CMP_ENABLE_NGINX || true
    fi
  fi
  CMP_ENABLE_NGINX=${CMP_ENABLE_NGINX:-Y}
fi
case "$(printf '%s' "$CMP_ENABLE_NGINX" | tr '[:upper:]' '[:lower:]')" in
  y|yes|1|true) CMP_ENABLE_NGINX=1 ;;
  *) CMP_ENABLE_NGINX=0 ;;
esac

warn "Primary domain: $DOMAIN"; warn "Additional domains: ${EXTRA_DOMAINS[*]:-(none)}"; warn "Port: $BACKEND_PORT"; warn "Admin user: $ADMIN_USER"

# Create directories
mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/configs"

# Optional integrity verification if script saved locally and expected hash provided.
if [ -n "${CMP_INSTALL_EXPECTED_SHA256:-}" ]; then
  SCRIPT_PATH="${BASH_SOURCE[0]}"
  if [ -f "$SCRIPT_PATH" ]; then
    ACTUAL_SHA=$(sha256sum "$SCRIPT_PATH" | awk '{print $1}')
    if [ "$ACTUAL_SHA" != "$CMP_INSTALL_EXPECTED_SHA256" ]; then
      die "Installer integrity check failed: expected $CMP_INSTALL_EXPECTED_SHA256 got $ACTUAL_SHA"
    else
      color "Installer integrity verified (sha256)"
    fi
  else
    warn "Integrity check requested but script path not found: $SCRIPT_PATH"
  fi
fi

# Download and extract the release tarball
# Fetch latest semantic release tag from GitHub API if CMP_CHECKOUT_REF not set
if [ -z "${CMP_CHECKOUT_REF:-}" ]; then
  color "Fetching latest release tag from GitHub..."
  LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/' || echo "v1.1.1")
  if [ -z "$LATEST_TAG" ] || [ "$LATEST_TAG" = "null" ]; then
    warn "Could not fetch latest release, falling back to v1.1.1"
    LATEST_TAG="v1.1.1"
  fi
  TAG="$LATEST_TAG"
else
  TAG="$CMP_CHECKOUT_REF"
fi
TARBALL_URL="https://github.com/${OWNER}/${REPO}/archive/refs/tags/${TAG}.tar.gz"

divider
section "Downloading release ${TAG}..."
color "Downloading release ${TAG}..."
# Use a temporary directory for download and extraction
TMP_DIR=$(mktemp -d)
curl -fsSL "$TARBALL_URL" | tar -xz -C "$TMP_DIR" --strip-components=1 || die "Failed to download or extract release tarball."

color "Moving application files to ${APP_DIR}..."
# Use rsync to move files, which handles existing directories gracefully
# Exclude Public_Release (local staging folder only, not for deployment)
rsync -a "$TMP_DIR/" "$APP_DIR/" --exclude='Public_Release' || die "Failed to move files to ${APP_DIR}"
rm -rf "$TMP_DIR"

# Ensure backend scripts are executable (e.g. update-unattended.sh for GUI Update Manager)
if [ -d "$BACKEND_DIR/scripts" ]; then
  chmod +x "$BACKEND_DIR/scripts/"*.sh 2>/dev/null || true
  color "Backend scripts marked executable"
fi

# Install/refresh Cloudflare credentials for certbot (always rewrite to match chosen mode)
if [ -f "$CF_CREDS_FILE" ]; then
  cp -f "$CF_CREDS_FILE" "${CF_CREDS_FILE}.bak.$(date +%s)" || true
fi
if [ "$CF_AUTH_MODE" = "key" ]; then
  cat > "$CF_CREDS_FILE" <<EOF
# Cloudflare Global API Key auth
dns_cloudflare_email = ${CF_ACCOUNT_EMAIL}
dns_cloudflare_api_key = ${CF_GLOBAL_KEY}
EOF
else
  cat > "$CF_CREDS_FILE" <<EOF
# Cloudflare API token with DNS edit for the zone of $DOMAIN
dns_cloudflare_api_token = $CF_API_TOKEN
EOF
fi
chmod 600 "$CF_CREDS_FILE"
color "Cloudflare credentials written to $CF_CREDS_FILE"

# Preflight: verify Cloudflare token and zone accessibility when using token auth
if [ "$CF_AUTH_MODE" = "token" ]; then
  if command -v curl >/dev/null 2>&1; then
    color "Verifying Cloudflare API token..."
    if curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify >/dev/null; then
      color "Cloudflare token is valid"
    else
      warn "Could not verify Cloudflare token (network or token issue). Proceeding anyway."
    fi
    # Best-effort zone check for the exact domain
    if curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" | grep -q '"success":true'; then
      color "Cloudflare zone check: ok for $DOMAIN"
    else
      warn "Cloudflare zone not found for $DOMAIN via token (may still work if delegated)."
    fi
  fi
fi

# Install Node dependencies
section "Installing backend dependencies..."
color "Installing backend dependencies..."
(cd "$BACKEND_DIR" && npm install --no-audit --no-fund)
section "Installing frontend dependencies..."
color "Installing frontend dependencies..."
(cd "$FRONTEND_DIR" && npm install --no-audit --no-fund)

# Check available memory and create swap if needed for frontend build
SWAP_CREATED=0
SWAP_FILE=""
if [ -f /proc/meminfo ]; then
  TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
  TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
  SWAP_FREE_KB=$(grep SwapFree /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)

  if [ "$TOTAL_MEM_MB" -lt 2048 ] && [ "$SWAP_FREE_KB" -lt 1048576 ]; then
    warn "Low memory detected (${TOTAL_MEM_MB}MB RAM, $((SWAP_FREE_KB / 1024))MB free swap). Preparing build swap..."
    
    # Proactively clean any stale swap files
    for old_swap in /tmp/cmp-build-swap* /var/tmp/cmp-build-swap* "$APP_DIR/cmp-build-swap*" /cmp-build-swap*; do
      if [ -f "$old_swap" ]; then
        swapoff "$old_swap" 2>/dev/null || true
        rm -f "$old_swap" 2>/dev/null || true
      fi
    done

    # Prefer disk-backed locations over tmpfs/ramfs
    SWAP_SIZE_MB=0
    for candidate in "$APP_DIR/cmp-build-swap" "/var/tmp/cmp-build-swap" "/cmp-build-swap"; do
      parent="$(dirname "$candidate")"
      [ -d "$parent" ] || continue
      [ -w "$parent" ] || continue
      
      # Skip if parent is on tmpfs or ramfs
      if command -v stat >/dev/null 2>&1; then
        case "$(stat -f -c %T "$parent" 2>/dev/null || echo '')" in
          tmpfs|ramfs|devtmpfs) continue ;;
        esac
      fi

      available_kb=$(df -P -k "$parent" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
      if [ "$available_kb" -ge 3670016 ]; then
        SWAP_SIZE_MB=1536
        SWAP_FILE="$candidate"
        break
      elif [ "$available_kb" -ge 2306867 ]; then
        SWAP_SIZE_MB=1024
        SWAP_FILE="$candidate"
        break
      elif [ "$available_kb" -ge 1572864 ]; then
        SWAP_SIZE_MB=512
        SWAP_FILE="$candidate"
        break
      fi
    done

    if [ -n "$SWAP_FILE" ] && [ "$SWAP_SIZE_MB" -gt 0 ]; then
      color "Allocating temporary ${SWAP_SIZE_MB}MB swap at $SWAP_FILE..."
      if dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=progress 2>/dev/null || dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none 2>/dev/null; then
        chmod 600 "$SWAP_FILE" 2>/dev/null || true
        if mkswap "$SWAP_FILE" >/dev/null 2>&1; then
          if swapon "$SWAP_FILE" 2>/dev/null; then
            SWAP_CREATED=1
            color "Temporary ${SWAP_SIZE_MB}MB swap activated"
          else
            warn "swapon failed or not permitted (e.g. inside container) — proceeding without swap"
            rm -f "$SWAP_FILE" 2>/dev/null || true
            SWAP_FILE=""
          fi
        else
          warn "mkswap failed — proceeding without swap"
          rm -f "$SWAP_FILE" 2>/dev/null || true
          SWAP_FILE=""
        fi
      else
        warn "Could not allocate swap file — proceeding without swap"
        rm -f "$SWAP_FILE" 2>/dev/null || true
        SWAP_FILE=""
      fi
    else
      warn "No location with sufficient disk space for swap found — proceeding without swap"
    fi
  elif [ "$TOTAL_MEM_MB" -lt 2048 ]; then
    color "System already has $((SWAP_FREE_KB / 1024))MB free swap — no temporary swap needed"
  fi
fi

# Build frontend with memory limit for Node.js
section "Building frontend..."
color "Building frontend..."
if [ "$SWAP_CREATED" -eq 1 ] || [ "${SWAP_FREE_KB:-0}" -gt 500000 ] || [ "${TOTAL_MEM_MB:-0}" -ge 2048 ]; then
  export NODE_OPTIONS="--max-old-space-size=1536"
else
  export NODE_OPTIONS="--max-old-space-size=768"
fi
(cd "$FRONTEND_DIR" && npm run build)
unset NODE_OPTIONS

# Remove temporary swap if we created it
if [ "$SWAP_CREATED" -eq 1 ] && [ -n "$SWAP_FILE" ]; then
  swapoff "$SWAP_FILE" 2>/dev/null || true
  rm -f "$SWAP_FILE" 2>/dev/null || true
  color "Temporary swap removed"
fi

# Generate .env if missing
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
PORT=$BACKEND_PORT
DOMAIN_NAME=$DOMAIN
LETSENCRYPT_EMAIL=$LE_EMAIL
CF_AUTH_MODE=$CF_AUTH_MODE
CLOUDFLARE_API_TOKEN=${CF_API_TOKEN:-}
CLOUDFLARE_GLOBAL_KEY=${CF_GLOBAL_KEY:-}
CLOUDFLARE_ACCOUNT_EMAIL=${CF_ACCOUNT_EMAIL:-}
START_TELEGRAM_BOT=true
JWT_SECRET=$(openssl rand -hex 48)
DB_HOST=$APP_DB_HOST
DB_PORT=$APP_DB_PORT
DB_DATABASE=$APP_DB_DATABASE
DB_USER=$APP_DB_USER
DB_PASSWORD=$APP_DB_PASSWORD
SEED_ADMIN_USERNAME=$ADMIN_USER
SEED_ADMIN_PASSWORD=$ADMIN_PASS
EOF
  chmod 600 "$ENV_FILE"
  color ".env created at $ENV_FILE"
else
  warn ".env already exists; attempting to ensure JWT_SECRET present"
  # If JWT_SECRET missing or blank, append a new one (preserve existing settings)
  if ! grep -q '^JWT_SECRET=' "$ENV_FILE"; then
    echo "JWT_SECRET=$(openssl rand -hex 48)" >> "$ENV_FILE"
    color "Appended missing JWT_SECRET to existing .env"
  else
    # If present but empty (e.g., JWT_SECRET=), replace line safely
    current_jwt=$(grep '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
    if [ -z "${current_jwt}" ]; then
      # Use temp file to edit in place without risking truncation
      tmpenv="${ENV_FILE}.tmp.$$"
      awk -F'=' 'BEGIN{OFS="="} /^JWT_SECRET=/ {print $1,"'$(openssl rand -hex 48)'"; next} {print}' "$ENV_FILE" > "$tmpenv" && mv "$tmpenv" "$ENV_FILE"
      color "Replaced empty JWT_SECRET with generated value"
    fi
  fi
  # If user chose to override DB settings, update them in-place
  if [ "$USE_EXISTING_DB" -eq 0 ]; then
    tmpenv="${ENV_FILE}.tmp.$$"
    awk -F'=' -v OFS='=' \
      -v h="$APP_DB_HOST" -v p="$APP_DB_PORT" -v d="$APP_DB_DATABASE" -v u="$APP_DB_USER" -v w="$APP_DB_PASSWORD" \
      'BEGIN{} \
       /^DB_HOST=/ {print "DB_HOST",h; next} \
       /^DB_PORT=/ {print "DB_PORT",p; next} \
       /^DB_DATABASE=/ {print "DB_DATABASE",d; next} \
       /^DB_USER=/ {print "DB_USER",u; next} \
       /^DB_PASSWORD=/ {print "DB_PASSWORD",w; next} \
       {print}' "$ENV_FILE" > "$tmpenv" && mv "$tmpenv" "$ENV_FILE"
    color "Updated DB settings in $ENV_FILE"
  fi
fi

# Also ensure a top-level .env exists with DB_* so scripts run from $APP_DIR work
DB_HOST_ROOT=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
DB_PORT_ROOT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
DB_DATABASE_ROOT=$(grep '^DB_DATABASE=' "$ENV_FILE" | cut -d= -f2-)
DB_USER_ROOT=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD_ROOT=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
if [ ! -f "$ROOT_ENV" ]; then
  cat > "$ROOT_ENV" <<EOF
DB_HOST=$DB_HOST_ROOT
DB_PORT=$DB_PORT_ROOT
DB_DATABASE=$DB_DATABASE_ROOT
DB_USER=$DB_USER_ROOT
DB_PASSWORD=$DB_PASSWORD_ROOT
EOF
  chmod 600 "$ROOT_ENV"
  color ".env created at $ROOT_ENV (DB settings)"
else
  for k in DB_HOST DB_PORT DB_DATABASE DB_USER DB_PASSWORD; do
    if ! grep -q "^${k}=" "$ROOT_ENV"; then
      v=$(grep "^${k}=" "$ENV_FILE" | cut -d= -f2-)
      echo "${k}=${v}" >> "$ROOT_ENV"
    fi
  done
fi

# ── Configure the built-in Key Server ───────────────────────────────────────
# Generates backend/data/keyserver.json so the key server is ready to run after install.
KEYSERVER_CONFIG_FILE="$BACKEND_DIR/data/keyserver.json"
# Auto-generate a secret key (32 random hex chars / 128-bit) unless one is provided
KEYSERVER_SECRET_KEY="${KEYSERVER_SECRET_KEY:-}"
if [ -z "$KEYSERVER_SECRET_KEY" ] && [ -f "$KEYSERVER_CONFIG_FILE" ]; then
  existing_secret=$(grep -o '"secretKey"[[:space:]]*:[[:space:]]*"[^"]*"' "$KEYSERVER_CONFIG_FILE" | head -1 | sed -E 's/.*"secretKey"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/' || true)
  if [ -n "$existing_secret" ]; then
    KEYSERVER_SECRET_KEY="$existing_secret"
    color "Reusing existing key server secret key from $KEYSERVER_CONFIG_FILE"
  fi
fi
if [ -z "$KEYSERVER_SECRET_KEY" ]; then
  KEYSERVER_SECRET_KEY=$(openssl rand -hex 32)
  color "Generated key server secret key"
fi

# Resolve the public domain (prefer explicit prompt; fall back to key.$DOMAIN)
if [ -n "$KEYSERVER_DOMAIN" ]; then
  KEYSERVER_PUBLIC_DOMAIN="$KEYSERVER_DOMAIN"
else
  KEYSERVER_PUBLIC_DOMAIN="${KEYSERVER_PUBLIC_DOMAIN:-key.${DOMAIN}}"
fi
# Normalize: strip any scheme so config stores a bare domain
KEYSERVER_PUBLIC_DOMAIN=$(echo "$KEYSERVER_PUBLIC_DOMAIN" | sed -E 's#^https?://##; s#/.*$##')

mkdir -p "$BACKEND_DIR/data"
mkdir -p "$KEYSERVER_CONFIG_DIR"
cat > "$KEYSERVER_CONFIG_FILE" <<EOF
{
  "port": ${KEYSERVER_PORT},
  "secretKey": "${KEYSERVER_SECRET_KEY}",
  "configDir": "${KEYSERVER_CONFIG_DIR}",
  "autoStart": true,
  "publicDomain": "${KEYSERVER_PUBLIC_DOMAIN}"
}
EOF
color "Key server configured: port ${KEYSERVER_PORT}, config dir ${KEYSERVER_CONFIG_DIR}, public domain ${KEYSERVER_PUBLIC_DOMAIN}"
color "Key server config written to $KEYSERVER_CONFIG_FILE"

# Database preparation (PostgreSQL local assumed)
section "Preparing database..."
color "Preparing database..."
# Create role & DB if not exist
psql_cmd="psql -v ON_ERROR_STOP=1"
DB_HOST=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
DB_DATABASE=$(grep '^DB_DATABASE=' "$ENV_FILE" | cut -d= -f2-)

# Check PostgreSQL is running / accessible
if [ "$DB_ADMIN_MODE" = "sudo" ]; then
  if ! sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
    warn "PostgreSQL not responding (sudo). Attempting to start..."
    systemctl start postgresql || die "Failed to start PostgreSQL"
    sleep 2
  fi
  # Re-test; if still failing due to password auth, attempt automatic trust escalation
  if ! sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
    warn "Local sudo connection failed (likely password auth enforced for 'postgres'). Attempting automatic trust escalation..."
    # Attempt trust escalation automatically when running as root
    set +e
    RAW_SERVER_VERSION=$(sudo -u postgres psql -d postgres -At -c "SHOW server_version" 2>/dev/null)
    if [ -z "$RAW_SERVER_VERSION" ]; then
      RAW_SERVER_VERSION=$(ls /etc/postgresql/ 2>/dev/null | grep -E '^[0-9]+' | sort -V | tail -n 1)
    fi
    set -e
    PG_VERSION=$(echo "$RAW_SERVER_VERSION" | cut -d. -f1)
    
    set +e
    PG_HBA_FILE=$(sudo -u postgres psql -d postgres -At -c "SHOW hba_file" 2>/dev/null)
    if [ -z "$PG_HBA_FILE" ] && [ -n "$PG_VERSION" ]; then
      PG_HBA_FILE=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | grep "/${PG_VERSION}/" | head -n 1)
    fi
    if [ -z "$PG_HBA_FILE" ]; then
      PG_HBA_FILE="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
    fi
    set -e
    
    if [ -f "$PG_HBA_FILE" ] && [ -w "$PG_HBA_FILE" ]; then
      # Add temporary trust rules at the top
      cp "$PG_HBA_FILE" "${PG_HBA_FILE}.cmp-backup.$(date +%s)"
      {
        echo "# CMP TEMP TRUST - will be removed after setup"
        echo "local   all             all                                     trust"
        cat "$PG_HBA_FILE"
      } > "${PG_HBA_FILE}.new"
      mv "${PG_HBA_FILE}.new" "$PG_HBA_FILE"
      
      systemctl restart postgresql || die "Failed to restart PostgreSQL"
      sleep 2
      
      if sudo -u postgres psql -c "SELECT 1" >/dev/null 2>&1; then
        color "Temporary trust escalation succeeded (will revert after DB setup)."
        DB_ADMIN_TEMP_TRUST=1
      else
        warn "Trust escalation applied but connection still fails"
        mv "${PG_HBA_FILE}.cmp-backup."* "$PG_HBA_FILE" 2>/dev/null || true
        die "Cannot connect to PostgreSQL even after trust escalation"
      fi
    else
      die "Cannot access pg_hba.conf at $PG_HBA_FILE for trust escalation. Ensure running as root."
    fi
  fi
else
  export PGPASSWORD="$DB_ADMIN_PASSWORD"
  if ! psql -h "$DB_ADMIN_HOST" -p "$DB_ADMIN_PORT" -U "$DB_ADMIN_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
    warn "Cannot connect with provided admin credentials ($DB_ADMIN_USER@$DB_ADMIN_HOST:$DB_ADMIN_PORT). Attempting temporary trust escalation..."
    # Attempt temporary trust escalation ONLY if running as root and pg_hba.conf accessible
    set +e
    RAW_SERVER_VERSION=$(sudo -u postgres psql -d postgres -At -c "SHOW server_version" 2>/dev/null)
    set -e
    PG_VERSION_FALL=$(echo "$RAW_SERVER_VERSION" | cut -d. -f1)
    
    # Fallback: try to detect version from /etc/postgresql directory if psql failed
    if [ -z "$PG_VERSION_FALL" ] && [ -d "/etc/postgresql" ]; then
      PG_VERSION_FALL=$(ls /etc/postgresql/ | grep -E '^[0-9]+' | sort -V | tail -n 1)
    fi

    set +e
    PG_HBA_FILE_FALL=$(sudo -u postgres psql -d postgres -At -c "SHOW hba_file" 2>/dev/null)
    set -e
    
    if [ -z "$PG_HBA_FILE_FALL" ]; then
      if [ -n "$PG_VERSION_FALL" ] && [ -f "/etc/postgresql/${PG_VERSION_FALL}/main/pg_hba.conf" ]; then
        PG_HBA_FILE_FALL="/etc/postgresql/${PG_VERSION_FALL}/main/pg_hba.conf"
      else
        # Last resort: find it
        PG_HBA_FILE_FALL=$(find /etc/postgresql -name pg_hba.conf 2>/dev/null | head -n 1)
      fi
    fi

    if [ -f "$PG_HBA_FILE_FALL" ]; then
      if ! grep -q "# CMP TEMP TRUST" "$PG_HBA_FILE_FALL"; then
        cp "$PG_HBA_FILE_FALL" "${PG_HBA_FILE_FALL}.bak.$(date +%s)" || die "Failed to backup pg_hba.conf for trust escalation"
        # Add trust for both local socket and IPv4/IPv6 localhost
        { 
          echo "# CMP TEMP TRUST - will be removed after installation"
          echo "local   all             all                                     trust"
          echo "host    all             all             127.0.0.1/32            trust"
          echo "host    all             all             ::1/128                 trust"
          cat "$PG_HBA_FILE_FALL"
        } > "${PG_HBA_FILE_FALL}.new" || die "Failed to build temporary trust pg_hba.conf"
        mv "${PG_HBA_FILE_FALL}.new" "$PG_HBA_FILE_FALL" || die "Failed to activate temporary trust pg_hba.conf"
        
        # Force restart instead of reload to ensure new auth rules take effect immediately
        if systemctl restart postgresql; then
           sleep 2
        else
           warn "Failed to restart PostgreSQL via systemctl, trying reload..."
           sudo -u postgres psql -d postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || true
           sleep 1
        fi
      fi
      
      # Retry without password (trust should allow it)
      # Try connecting via socket first (no -h) then localhost
      if ! psql -U "$DB_ADMIN_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
         if ! psql -h 127.0.0.1 -p "$DB_ADMIN_PORT" -U "$DB_ADMIN_USER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
            die "Temporary trust escalation failed to obtain admin access."
         fi
      fi
      
      color "Temporary trust escalation succeeded (will revert after DB setup)."
      DB_ADMIN_TEMP_TRUST=1
      # Switch to trust-based connection (no password needed now)
      unset PGPASSWORD
      DB_ADMIN_PASSWORD=""
      # Force Unix socket connection by unsetting host
      DB_ADMIN_HOST=""
    else
      die "Cannot connect and pg_hba.conf not found for trust escalation ($PG_HBA_FILE_FALL)"
    fi
  fi
  unset PGPASSWORD
fi

# Run psql to create role/db (sudo, TCP with password, or TCP with trust)
if [ "$DB_ADMIN_MODE" = "sudo" ]; then
  # Run psql from postgres' home directory to avoid noisy 'could not change directory to /root'
  if sudo -u postgres bash -lc "cd; psql -At -c \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\"" | grep -q 1; then
    color "Database user '$DB_USER' already exists"
  else
    color "Creating database user '$DB_USER'..."
    sudo -u postgres bash -lc "cd; psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';\"" || die "Failed to create database user '$DB_USER'"
  fi

  if sudo -u postgres bash -lc "cd; psql -At -c \"SELECT 1 FROM pg_database WHERE datname='$DB_DATABASE'\"" | grep -q 1; then
    color "Database '$DB_DATABASE' already exists"
  else
    color "Creating database '$DB_DATABASE'..."
    sudo -u postgres bash -lc "cd; psql -c \"CREATE DATABASE $DB_DATABASE OWNER $DB_USER;\"" || die "Failed to create database '$DB_DATABASE'"
  fi
else
  # Use password only if trust escalation wasn't used
  if [ "${DB_ADMIN_TEMP_TRUST:-0}" -eq 0 ]; then
    export PGPASSWORD="$DB_ADMIN_PASSWORD"
  fi
  
  # Build psql connection args based on whether we're using Unix socket (trust) or TCP
  PSQL_CONNECT_ARGS="-U $DB_ADMIN_USER"
  if [ -n "$DB_ADMIN_HOST" ]; then
    PSQL_CONNECT_ARGS="$PSQL_CONNECT_ARGS -h $DB_ADMIN_HOST -p $DB_ADMIN_PORT"
  fi
  
  if psql $PSQL_CONNECT_ARGS -d postgres -At -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; then
    color "Database user '$DB_USER' already exists"
  else
    color "Creating database user '$DB_USER'..."
    psql $PSQL_CONNECT_ARGS -d postgres -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';" || die "Failed to create database user '$DB_USER'"
  fi
  if psql $PSQL_CONNECT_ARGS -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='$DB_DATABASE'" 2>/dev/null | grep -q 1; then
    color "Database '$DB_DATABASE' already exists"
  else
    color "Creating database '$DB_DATABASE'..."
    psql $PSQL_CONNECT_ARGS -d postgres -c "CREATE DATABASE $DB_DATABASE OWNER $DB_USER;" || die "Failed to create database '$DB_DATABASE'"
  fi
  unset PGPASSWORD
fi

# Configure pg_hba.conf for password authentication BEFORE testing
color "Configuring PostgreSQL authentication..."
set +e
RAW_SERVER_VERSION=$(sudo -u postgres psql -d postgres -At -c "SHOW server_version" 2>/dev/null)
set -e
PG_VERSION=$(echo "$RAW_SERVER_VERSION" | cut -d. -f1)
if [ -z "$PG_VERSION" ]; then
  for d in /etc/postgresql/*; do
    if [ -d "$d" ]; then
      b=$(basename "$d")
      if echo "$b" | grep -Eq '^[0-9]+'; then PG_VERSION="$b"; fi
    fi
  done
fi
set +e
PG_HBA_FILE=$(sudo -u postgres psql -d postgres -At -c "SHOW hba_file" 2>/dev/null)
set -e
if [ -z "$PG_HBA_FILE" ]; then
  PG_HBA_FILE="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"
fi
color "pg_hba.conf path: $PG_HBA_FILE"
if [ ! -f "$PG_HBA_FILE" ]; then
  die "pg_hba.conf not found at: $PG_HBA_FILE"
fi

# Check if md5/scram-sha-256 rule already exists for local connections
color "Checking existing authentication rules..."
HAS_LOCAL_PW=0; HAS_HOST4_PW=0; HAS_HOST6_PW=0
grep -Eq "^local\s+all\s+all\s+(md5|scram-sha-256)" "$PG_HBA_FILE" && HAS_LOCAL_PW=1
grep -Eq "^host\s+all\s+all\s+127\.0\.0\.1/32\s+(md5|scram-sha-256)" "$PG_HBA_FILE" && HAS_HOST4_PW=1
grep -Eq "^host\s+all\s+all\s+::1/128\s+(md5|scram-sha-256)" "$PG_HBA_FILE" && HAS_HOST6_PW=1

if [ $HAS_LOCAL_PW -eq 1 ] && [ $HAS_HOST4_PW -eq 1 ] && [ $HAS_HOST6_PW -eq 1 ]; then
  color "Password authentication already enabled (local + localhost)"
else
  color "Adding password authentication rules to pg_hba.conf..."
  cp "$PG_HBA_FILE" "${PG_HBA_FILE}.bak.$(date +%s)" || die "Failed to backup pg_hba.conf"
  TMP_HBA="${PG_HBA_FILE}.new"
  {
    echo "# Added by CMP installer $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    [ $HAS_LOCAL_PW -eq 1 ] || echo "local   all             all                                     md5"
    [ $HAS_HOST4_PW -eq 1 ] || echo "host    all             all             127.0.0.1/32            md5"
    [ $HAS_HOST6_PW -eq 1 ] || echo "host    all             all             ::1/128                 md5"
    cat "$PG_HBA_FILE"
  } > "$TMP_HBA" || die "Failed to construct new pg_hba.conf"
  mv "$TMP_HBA" "$PG_HBA_FILE" || die "Failed to overwrite pg_hba.conf"
  color "Reloading PostgreSQL configuration..."
  systemctl reload postgresql >/dev/null 2>&1 || sudo -u postgres psql -d postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || true
  sleep 2
  color "PostgreSQL authentication configured"
fi

# Show the first few relevant lines for diagnostics
grep -nE '^(local|host).*?(127\.0\.0\.1|::1|all\s+all\s+(md5|scram-sha-256))' "$PG_HBA_FILE" | head -10 || true

# Verify connection works
color "Testing database connection..."
set +e
export PGPASSWORD="$DB_PASSWORD"
CONNECTION_OUTPUT=$(timeout 10 psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_DATABASE" -c "SELECT 1" 2>&1)
CONNECTION_STATUS=$?
unset PGPASSWORD
set -e

if [ $CONNECTION_STATUS -eq 0 ]; then
  color "Database connection verified"
else
  echo "Connection test output: $CONNECTION_OUTPUT"
  die "Database connection failed. Please check:\n  1. PostgreSQL is running: systemctl status postgresql\n  2. Database credentials in /srv/cmp/.env\n  3. PostgreSQL logs: sudo tail -50 /var/log/postgresql/postgresql-${PG_VERSION}-main.log"
fi

# Run migrations BEFORE removing trust (so postgres can modify all objects)
color "Running migrations..."
(cd "$BACKEND_DIR" && node run_migrations.js || die "Migrations failed")

# Transfer ownership of all database objects to the app user
if [ "${DB_ADMIN_TEMP_TRUST:-0}" = "1" ] || [ "$DB_ADMIN_MODE" = "sudo" ]; then
  color "Transferring database ownership to $DB_USER..."
  if [ "$DB_ADMIN_MODE" = "sudo" ]; then
    sudo -u postgres psql -d "$DB_DATABASE" -c "REASSIGN OWNED BY postgres TO $DB_USER;" 2>/dev/null || warn "Could not reassign ownership (may be normal)"
  else
    PSQL_CONNECT_ARGS="-U $DB_ADMIN_USER"
    if [ -n "$DB_ADMIN_HOST" ]; then
      PSQL_CONNECT_ARGS="$PSQL_CONNECT_ARGS -h $DB_ADMIN_HOST -p $DB_ADMIN_PORT"
    fi
    psql $PSQL_CONNECT_ARGS -d "$DB_DATABASE" -c "REASSIGN OWNED BY $DB_ADMIN_USER TO $DB_USER;" 2>/dev/null || warn "Could not reassign ownership (may be normal)"
  fi
fi

# Revert temporary trust if used
if [ "${DB_ADMIN_TEMP_TRUST:-0}" = "1" ]; then
  color "Reverting temporary trust authentication..."
  set +e
  RAW_SERVER_VERSION=$(sudo -u postgres psql -d postgres -At -c "SHOW server_version" 2>/dev/null)
  set -e
  PG_VERSION_CLEAN=$(echo "$RAW_SERVER_VERSION" | cut -d. -f1)
  set +e
  PG_HBA_CLEAN=$(sudo -u postgres psql -d postgres -At -c "SHOW hba_file" 2>/dev/null)
  set -e
  if [ -z "$PG_HBA_CLEAN" ]; then PG_HBA_CLEAN="/etc/postgresql/${PG_VERSION_CLEAN}/main/pg_hba.conf"; fi
  if [ -f "$PG_HBA_CLEAN" ]; then
    grep -v "CMP TEMP TRUST" "$PG_HBA_CLEAN" | awk '!/^local\s+all\s+all\s+trust$/' > "${PG_HBA_CLEAN}.new" && mv "${PG_HBA_CLEAN}.new" "$PG_HBA_CLEAN"
    systemctl reload postgresql >/dev/null 2>&1 || sudo -u postgres psql -d postgres -c "SELECT pg_reload_conf();" >/dev/null 2>&1 || true
    color "Temporary trust removed"
  else
    warn "Expected pg_hba.conf for cleanup not found: $PG_HBA_CLEAN"
  fi
fi

color "Seeding admin & servers..."
(cd "$BACKEND_DIR" && node seedAdmin.js)
(cd "$BACKEND_DIR" && node seedServers.js)
if [ -f "$BACKEND_DIR/seedUsers.js" ]; then
  (cd "$BACKEND_DIR" && node seedUsers.js)
fi

# Seed default app settings (general/database/panel) without secrets
if [ -f "$BACKEND_DIR/scripts/seed_default_settings.js" ]; then
  color "Seeding default app settings (non-sensitive)"
  (cd "$BACKEND_DIR" && node scripts/seed_default_settings.js || warn "Default settings seed failed; continuing")
fi

# Certificate issuance (DNS-01 via Cloudflare, optional HTTP fallback)
CERT_PRIMARY_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
# Include the key server public domain in certificate issuance so the key
# server vhost gets a valid HTTPS cert on a fresh install.
ALL_DOMAINS=("$DOMAIN" "${EXTRA_DOMAINS[@]}")
if [ -n "${KEYSERVER_PUBLIC_DOMAIN:-}" ] && [ "$KEYSERVER_PUBLIC_DOMAIN" != "$DOMAIN" ]; then
  ALL_DOMAINS+=("$KEYSERVER_PUBLIC_DOMAIN")
fi
build_domain_args() { for host in "${ALL_DOMAINS[@]}"; do printf -- " -d %s" "$host"; done; }

CERT_OK=0
# Determine if any cert is missing (portal or key server) so we issue for all.
KEY_CERT_PATH="/etc/letsencrypt/live/${KEYSERVER_PUBLIC_DOMAIN:-none}/fullchain.pem"
CERT_NEEDED=0
[ ! -f "$CERT_PRIMARY_PATH" ] && CERT_NEEDED=1
[ -n "${KEYSERVER_PUBLIC_DOMAIN:-}" ] && [ ! -f "$KEY_CERT_PATH" ] && CERT_NEEDED=1
if [ "${CMP_SKIP_CERT:-}" = "1" ]; then
  warn "Skipping certificate issuance per CMP_SKIP_CERT=1"
else
  if [ "$CERT_NEEDED" -eq 1 ]; then
    color "Requesting certificate (DNS-01 Cloudflare) for: ${ALL_DOMAINS[*]}"
    # Ensure dns-cloudflare plugin present (Debian/Ubuntu best-effort)
    if ! certbot plugins 2>/dev/null | grep -q dns-cloudflare; then
      if command -v apt-get >/dev/null 2>&1; then
        warn "dns-cloudflare plugin missing (installing via apt)..."
        apt-get update -y || true
        apt-get install -y python3-certbot-dns-cloudflare || warn "Failed to install python3-certbot-dns-cloudflare; proceeding (may fail)"
      else
        warn "dns-cloudflare plugin not detected and apt-get unavailable; cert issuance may fail"
      fi
    fi
    PROP_SECS=${CMP_DNS_PROPAGATION_SECONDS:-10}
    set +e
    certbot certonly --dns-cloudflare --dns-cloudflare-credentials "$CF_CREDS_FILE" \
      --dns-cloudflare-propagation-seconds "$PROP_SECS" \
      $(build_domain_args) -m "$LE_EMAIL" --agree-tos --non-interactive
    CERT_EXIT=$?
    set -e
    if [ $CERT_EXIT -ne 0 ]; then
      err "DNS-01 issuance failed (exit $CERT_EXIT)"
      # Check if domain can actually be in Cloudflare (not third-party DNS like dpdns.org)
      if echo "$DOMAIN" | grep -qE '\.(dpdns|ddns|no-ip|duckdns)\.(org|net|com)$'; then
        warn "Domain appears to be from a third-party dynamic DNS service (DynDNS, No-IP, etc.)"
        warn "These domains cannot use Cloudflare DNS-01. Automatically trying HTTP-01..."
        FORCE_HTTP_FALLBACK=1
      fi
      # Auto-enable HTTP-01 fallback unless explicitly disabled
      if [ "${CMP_CERT_HTTP_FALLBACK:-auto}" != "0" ] || [ "${FORCE_HTTP_FALLBACK:-0}" = "1" ]; then
        warn "Attempting HTTP-01 fallback (standalone)..."
        warn "Ensure port 80 is open and points to this server"
        # Stop backend to free :80 if running
        systemctl stop $BACKEND_SERVICE 2>/dev/null || true
        set +e
        certbot certonly --standalone $(build_domain_args) -m "$LE_EMAIL" --preferred-challenges http --agree-tos --non-interactive
        FB_EXIT=$?
        set -e
        if [ $FB_EXIT -ne 0 ]; then
          warn "HTTP-01 fallback also failed (exit $FB_EXIT). Proceeding without TLS."
          warn "You can access the portal via HTTP on port $BACKEND_PORT"
          warn "Or manually configure certificates later"
        else
          color "HTTP-01 fallback succeeded"
          CERT_OK=1
        fi
      else
        warn "Certificate issuance failed (DNS-01) and fallback disabled (CMP_CERT_HTTP_FALLBACK=0). Proceeding without TLS."
      fi
    else
      color "Certificate issuance succeeded"
      CERT_OK=1
    fi
  else
    warn "Certificate already present for $DOMAIN; skipping issuance"
    CERT_OK=1
  fi
fi

# Systemd service files (only create if absent to allow manual edits)
if [ ! -f "$SYSTEMD_DIR/$BACKEND_SERVICE" ]; then
cat > "$SYSTEMD_DIR/$BACKEND_SERVICE" <<EOF
[Unit]
Description=CMP Backend Service
After=network.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$BACKEND_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node index.js
Restart=on-failure
RestartSec=5s
User=root
# Hardening
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
    PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable $BACKEND_SERVICE
fi

if [ -f "$BACKEND_DIR/pm2.config.js" ] && [ ! -f "$SYSTEMD_DIR/$BOT_SERVICE" ]; then
cat > "$SYSTEMD_DIR/$BOT_SERVICE" <<EOF
[Unit]
Description=CMP Telegram Bot
After=network.target

[Service]
Type=simple
WorkingDirectory=$BACKEND_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env node telegram_bot.js
Restart=on-failure
RestartSec=5s
User=root
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable $BOT_SERVICE
fi

# Optional: Install and configure Nginx as reverse proxy for HTTPS
if [ "$CMP_ENABLE_NGINX" = "1" ]; then
  if ! command -v nginx >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      section "Installing nginx..."
      color "Installing nginx..."
      
      # Wait for dpkg locks to be released (max 300 seconds)
      waited=0
      while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || fuser /var/lib/apt/lists/lock >/dev/null 2>&1; do
        if [ $waited -eq 0 ]; then
          warn "Waiting for other package managers to finish..."
        fi
        sleep 5
        waited=$((waited + 5))
        if [ $waited -ge 300 ]; then
          warn "Timeout waiting for package manager locks after 5 minutes"
          break
        fi
      done
      
      apt-get update -y || true
      apt-get install -y nginx || warn "Failed to install nginx"
    else
      warn "apt-get not found; skipping nginx installation"
    fi
  fi
  if command -v nginx >/dev/null 2>&1; then
    section "Configuring nginx..."
    color "Configuring nginx for $DOMAIN..."
    mkdir -p /var/www/letsencrypt
    NCONF="/etc/nginx/sites-available/cmp-$DOMAIN.conf"
    # Never overwrite an existing vhost (nginx may already be serving this domain)
    if [ -f "$NCONF" ]; then
      warn "Vhost $NCONF already exists; leaving it untouched."
      ln -sf "$NCONF" "/etc/nginx/sites-enabled/cmp-$DOMAIN.conf" 2>/dev/null || true
    else
    if [ "$CERT_OK" -eq 1 ]; then
      cat > "$NCONF" <<EOF
upstream cmp_backend {
    server 127.0.0.1:$BACKEND_PORT;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

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
    server_name $DOMAIN;

    # Allow large JSON payloads (key server backup/restore, admin restore)
    client_max_body_size 200m;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
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
    else
      cat > "$NCONF" <<EOF
upstream cmp_backend {
    server 127.0.0.1:$BACKEND_PORT;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Allow large JSON payloads (key server backup/restore, admin restore)
    client_max_body_size 200m;

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
      warn "TLS not configured; serving HTTP only. Re-run installer with valid Cloudflare credentials or obtain certs later."
    fi
    ln -sf "$NCONF" "/etc/nginx/sites-enabled/cmp-$DOMAIN.conf"
    fi # end: vhost did not already exist
    if nginx -t; then
      # Use reload (non-disruptive) so existing domains keep serving during apply
      systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
      color "nginx configured and reloaded"
    else
      err "nginx configuration test failed; please review $NCONF"
    fi
  fi
fi

# ── Key server nginx vhost (proxies the key server on :8088) ───────────────
# Creates an isolated vhost for the key server public domain so it is exposed
# over HTTPS alongside the portal, without touching existing nginx domains.
# Ensures a valid HTTPS vhost is applied: if the key-domain certificate is
# missing, it is issued (HTTP-01) before the vhost is written.
if command -v nginx >/dev/null 2>&1 && [ -n "${KEYSERVER_PUBLIC_DOMAIN:-}" ]; then
  KEY_NCONF="/etc/nginx/sites-available/cmp-${KEYSERVER_PUBLIC_DOMAIN}.conf"
  KEY_NENABLED="/etc/nginx/sites-enabled/cmp-${KEYSERVER_PUBLIC_DOMAIN}.conf"
  KEY_CERT_PATH="/etc/letsencrypt/live/${KEYSERVER_PUBLIC_DOMAIN}/fullchain.pem"
  KEY_KEY_PATH="/etc/letsencrypt/live/${KEYSERVER_PUBLIC_DOMAIN}/privkey.pem"

  # Ensure a certificate exists for the key server domain so HTTPS works.
  if [ ! -f "$KEY_CERT_PATH" ] || [ ! -f "$KEY_KEY_PATH" ]; then
    if [ "${CMP_SKIP_CERT:-}" = "1" ]; then
      skip "Key server cert skipped (CMP_SKIP_CERT=1); HTTPS for key domain not configured."
    else
      info "No certificate for key server domain ${KEYSERVER_PUBLIC_DOMAIN}; issuing via HTTP-01..."
      systemctl stop $BACKEND_SERVICE 2>/dev/null || true
      set +e
      certbot certonly --standalone -d "$KEYSERVER_PUBLIC_DOMAIN" \
        -m "${LE_EMAIL:-}" --preferred-challenges http --agree-tos --non-interactive
      KEY_CERT_EXIT=$?
      set -e
      if [ $KEY_CERT_EXIT -ne 0 ]; then
        warn "Key server cert issuance failed (exit $KEY_CERT_EXIT). HTTPS for key domain unavailable."
      else
        ok "Key server certificate issued for ${KEYSERVER_PUBLIC_DOMAIN}"
      fi
      systemctl start $BACKEND_SERVICE 2>/dev/null || true
    fi
  fi

  # Build the vhost. Default upstream block shared by all server blocks.
  cat > "$KEY_NCONF" <<EOF
upstream cmp_keyserver {
    server 127.0.0.1:${KEYSERVER_PORT};
    keepalive 32;
}
EOF

  if [ -f "$KEY_CERT_PATH" ] && [ -f "$KEY_KEY_PATH" ]; then
    # Certificate present: serve HTTPS and redirect HTTP → HTTPS.
    cat >> "$KEY_NCONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${KEYSERVER_PUBLIC_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${KEYSERVER_PUBLIC_DOMAIN};

    client_max_body_size 200m;

    ssl_certificate ${KEY_CERT_PATH};
    ssl_certificate_key ${KEY_KEY_PATH};
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
  else
    # No certificate available: serve the key server directly over HTTP.
    cat >> "$KEY_NCONF" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${KEYSERVER_PUBLIC_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

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
    warn "Key server certificate unavailable; serving HTTP only for ${KEYSERVER_PUBLIC_DOMAIN}."
  fi

  ln -sf "$KEY_NCONF" "$KEY_NENABLED"
  if nginx -t; then
    systemctl reload nginx 2>/dev/null || systemctl restart nginx || true
    color "Key server nginx vhost configured for ${KEYSERVER_PUBLIC_DOMAIN} (port ${KEYSERVER_PORT}, HTTPS=$([ -f "$KEY_CERT_PATH" ] && echo yes || echo no))"
  else
    err "nginx configuration test failed for key server vhost; please review $KEY_NCONF"
  fi
fi

# Certbot renewal timer is usually already present; ensure post-renew hook reload if changed
RENEW_HOOK="/usr/local/bin/cmp-post-renew.sh"
cat > "$RENEW_HOOK" <<'EOF'
#!/usr/bin/env bash
set -e
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || systemctl restart nginx || true
fi
EOF
chmod +x "$RENEW_HOOK"

# Add deploy hook if not present in renewal conf
RENEW_CONF="/etc/letsencrypt/renewal/$DOMAIN.conf"
if [ -f "$RENEW_CONF" ] && ! grep -q "deploy_hook = $RENEW_HOOK" "$RENEW_CONF"; then
  echo "deploy_hook = $RENEW_HOOK" >> "$RENEW_CONF"
fi

color "Starting services..."
divider
section "Starting services..."
systemctl restart $BACKEND_SERVICE || true
if systemctl list-unit-files | grep -q "$BOT_SERVICE"; then
  systemctl restart $BOT_SERVICE || true
fi

# Health probe
PROBE_RETRIES=${CMP_HEALTH_PROBE_RETRIES:-6}
PROBE_INTERVAL=${CMP_HEALTH_PROBE_INTERVAL:-2}
color "Probing backend health (retries=$PROBE_RETRIES interval=${PROBE_INTERVAL}s)..."
probe_ok=0
for i in $(seq 1 $PROBE_RETRIES); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" >/dev/null 2>&1; then
    probe_ok=1; break; fi
  sleep "$PROBE_INTERVAL"
done
if [ $probe_ok -eq 1 ]; then
  color "Health probe: OK"
else
  warn "Health probe failed (no successful /api/health in $PROBE_RETRIES attempts)"
fi

color "Installation complete"
echo "Primary domain: https://$DOMAIN"
echo "All domains: ${ALL_DOMAINS[*]}"
echo "Backend service: $BACKEND_SERVICE (port $BACKEND_PORT)"
echo "Admin credentials: $ADMIN_USER / $ADMIN_PASS"

# v1.6.0 verification tips (automated checks)
color "v1.6.0 verification: running lightweight checks..."
# 1) Check app version reported by /api/health
if command -v curl >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  VER=$(curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" | jq -r '.versions.appVersion // empty') || VER=""
  if [ -n "$VER" ]; then
    color "Backend reports app version: $VER"
  else
    warn "Could not read app version from /api/health"
  fi
  # 2) Check telegram bot status endpoint
  BOTSTATUS=$(curl -fsS "http://127.0.0.1:$BACKEND_PORT/internal/bot/status" 2>/dev/null || echo "")
  if [ -n "$BOTSTATUS" ]; then
    color "Telegram bot status endpoint returned data (see /internal/bot/status)."
  else
    warn "Telegram bot status endpoint did not return data (ensure bot started and backend DB is accessible)."
  fi
else
  warn "Skipping automated v1.3.0 checks: 'curl' and/or 'jq' not available on this system."
fi

cat <<'EOF'

Manual verification (GUI):

- Open the frontend and go to Settings → General. Confirm the timezone selector shows a live current date/time preview.
- Open Servers → Server list and confirm a "Transfer user" control is available on server rows for Admin/Server Admin roles.
- Open Financial page and inspect the monthly report table; ensure month headers and values appear correctly for your timezone.
- Navigate to any server detail page and verify the user enable/disable toggle icon (checkmark/slash) is present.
- Test disabling a user: click the enable/disable icon, verify the user row becomes grayed out with status "Disabled".
- Verify disabled users appear in lists but are excluded from all counts (Total Users, Active, Soon, Expired, Mini, Basic, Unlimited).
- Check that the "Disabled" filter option is available in the status dropdown and shows only disabled users when selected.

If you want scripted, authenticated verification, provide an admin API token or DB access and I can add a post-install verification script that exercises the admin endpoints.

EOF
