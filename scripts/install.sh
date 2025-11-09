#!/usr/bin/env bash
set -euo pipefail

# User Management Portal Installer (certbot + Cloudflare DNS)
# Requirements: bash, sudo/root, git, curl, openssl, systemd, certbot, python3-certbot-dns-cloudflare
# Node (>=18) will be auto-installed if missing unless CMP_SKIP_NODE_AUTO_INSTALL=1
# This script is idempotent where possible; re-running updates missing pieces.

APP_NAME="customer-management-portal"
REPO_URL="${REPO_URL_OVERRIDE:-https://github.com/koyan-testpilot/customer-management-portal.git}"
APP_DIR="/srv/cmp"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
ENV_FILE="$BACKEND_DIR/.env"
CF_CREDS_FILE="/root/.cloudflare.ini"
SYSTEMD_DIR="/etc/systemd/system"
BACKEND_SERVICE="cmp-backend.service"
BOT_SERVICE="cmp-telegram-bot.service"

color() { echo -e "\033[1;32m$1\033[0m"; }
warn() { echo -e "\033[1;33m$1\033[0m"; }
err() { echo -e "\033[1;31m$1\033[0m"; }

die() { err "ERROR: $1"; exit 1; }
require_root() { [ "$(id -u)" -eq 0 ] || die "Run as root"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || return 1; }

auto_install_node() {
  if [ "${CMP_SKIP_NODE_AUTO_INSTALL:-}" = "1" ]; then
    die "Missing required command: node (auto-install skipped due to CMP_SKIP_NODE_AUTO_INSTALL=1)"
  fi
  warn "Node.js not found – attempting automatic install (20.x LTS)."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - || die "NodeSource setup failed"
    apt-get install -y nodejs || die "Node.js install failed"
  else
    die "curl missing; cannot auto-install Node.js"
  fi
}

check_deps() {
  local missing=()
  for c in git curl openssl certbot python3; do
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

# Collect inputs
require_root
check_deps

prompt_if_empty DOMAIN "Enter domain name (FQDN)"

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
prompt_if_empty ADMIN_USER "Admin username" false admin
prompt_if_empty ADMIN_PASS "Admin password (will be stored hashed in DB)" true admin123

warn "Domain: $DOMAIN"; warn "Port: $BACKEND_PORT"; warn "Admin user: $ADMIN_USER"

# Create directories
mkdir -p "$APP_DIR"

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

if [ ! -d "$APP_DIR/.git" ]; then
  color "Cloning repository..."
  git clone "$REPO_URL" "$APP_DIR"
else
  color "Repo exists - fetching updates..."
  (cd "$APP_DIR" && git fetch --all --tags)
fi

# Install Cloudflare credentials for certbot
if [ ! -f "$CF_CREDS_FILE" ]; then
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
fi

# Install Node dependencies
color "Installing backend dependencies..."
(cd "$BACKEND_DIR" && npm install --no-audit --no-fund)
color "Installing frontend dependencies..."
(cd "$FRONTEND_DIR" && npm install --no-audit --no-fund)

# Build frontend
color "Building frontend..."
(cd "$FRONTEND_DIR" && npm run build)

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
JWT_SECRET=$(openssl rand -hex 32)
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=cmp
DB_USER=cmp
DB_PASSWORD=$(openssl rand -hex 12)
SEED_ADMIN_USERNAME=$ADMIN_USER
SEED_ADMIN_PASSWORD=$ADMIN_PASS
EOF
  chmod 600 "$ENV_FILE"
  color ".env created at $ENV_FILE"
else
  warn ".env already exists; not overwriting"
fi

# Database preparation (PostgreSQL local assumed)
color "Preparing database..."
# Create role & DB if not exist (best-effort)
psql_cmd="psql -v ON_ERROR_STOP=1"
DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
DB_DATABASE=$(grep '^DB_DATABASE=' "$ENV_FILE" | cut -d= -f2-)

sudo -u postgres bash -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'\" | grep -q 1 || psql -c \"CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';\"" || true
sudo -u postgres bash -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$DB_DATABASE'\" | grep -q 1 || psql -c \"CREATE DATABASE $DB_DATABASE OWNER $DB_USER;\"" || true

color "Running migrations..."
(cd "$BACKEND_DIR" && node run_migrations.js)

color "Seeding admin & servers..."
(cd "$BACKEND_DIR" && node seedAdmin.js)
(cd "$BACKEND_DIR" && node seedServers.js)
if [ -f "$BACKEND_DIR/seedUsers.js" ]; then
  (cd "$BACKEND_DIR" && node seedUsers.js)
fi

# Issue certificate if none exists
CERT_PATH="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
if [ ! -f "$CERT_PATH" ]; then
  color "Requesting initial certificate via certbot (Cloudflare DNS)..."
  certbot certonly --dns-cloudflare --dns-cloudflare-credentials "$CF_CREDS_FILE" -d "$DOMAIN" -m "$LE_EMAIL" --agree-tos --non-interactive || die "Certbot issuance failed"
else
  warn "Certificate already present; skipping issuance"
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
ExecStart=/usr/bin/node index.js
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
ExecStart=/usr/bin/node telegram_bot.js
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

# Certbot renewal timer is usually already present; ensure post-renew hook reload if changed
RENEW_HOOK="/usr/local/bin/cmp-post-renew.sh"
cat > "$RENEW_HOOK" <<'EOF'
#!/usr/bin/env bash
set -e
CHANGED=0
if systemctl is-active --quiet cmp-backend.service; then
  systemctl restart cmp-backend.service || true
fi
EOF
chmod +x "$RENEW_HOOK"

# Add deploy hook if not present in renewal conf
RENEW_CONF="/etc/letsencrypt/renewal/$DOMAIN.conf"
if [ -f "$RENEW_CONF" ] && ! grep -q "deploy_hook = $RENEW_HOOK" "$RENEW_CONF"; then
  echo "deploy_hook = $RENEW_HOOK" >> "$RENEW_CONF"
fi

color "Starting services..."
systemctl restart $BACKEND_SERVICE || true
if systemctl list-unit-files | grep -q "$BOT_SERVICE"; then
  systemctl restart $BOT_SERVICE || true
fi

color "Installation complete"
echo "Domain: https://$DOMAIN"
echo "Backend service: $BACKEND_SERVICE (port $BACKEND_PORT)"
echo "Admin credentials: $ADMIN_USER / $ADMIN_PASS"
