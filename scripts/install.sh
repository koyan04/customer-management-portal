#!/usr/bin/env bash
set -euo pipefail

# Customer Management Portal Installer
# Features:
#   - Downloads latest release tarball instead of cloning
#   - Installs Node.js automatically (Debian/Ubuntu) unless CMP_SKIP_NODE_AUTO_INSTALL=1
#   - Builds frontend, runs migrations, seeds admin + sample data
#   - Issues Let's Encrypt certificate (DNS-01 via Cloudflare) for one or more domains
#   - Optional HTTP-01 fallback if DNS challenge fails (set CMP_CERT_HTTP_FALLBACK=1)
#   - Supports multiple domains via CMP_CERT_DOMAINS (comma or space separated)
#   - Skip certificate issuance entirely with CMP_SKIP_CERT=1
#   - Health probe after startup (/api/health) with summary
#   - Integrity self-check if CMP_INSTALL_EXPECTED_SHA256 provided
# Environment Flags (summary):
#   CMP_CHECKOUT_REF=ref|tag|commit         Force checkout of specific ref
#   CMP_SKIP_AUTO_CHECKOUT=1                Keep current repo checkout
#   CMP_SKIP_NODE_AUTO_INSTALL=1            Require preinstalled Node
#   CMP_INSTALL_EXPECTED_SHA256=<sha>       Verify installer integrity
#   CMP_CERT_DOMAINS="example.com www.example.com"  Additional domains (primary still prompted)
#   CMP_CERT_HTTP_FALLBACK=1                Attempt standalone HTTP-01 on DNS failure
#   CMP_SKIP_CERT=1                         Do not issue certificates
#   CMP_ENABLE_NGINX=1                      Install & configure Nginx reverse proxy for HTTPS (default: prompt)
#   CF_AUTH_MODE=token|key                  Pre-select Cloudflare auth mode
# Environment Flags (summary):
#   CMP_CHECKOUT_REF=ref|tag|commit         Force download of specific release version
#   CMP_SKIP_NODE_AUTO_INSTALL=1            Require preinstalled Node
#   CMP_INSTALL_EXPECTED_SHA256=<sha>       Verify installer integrity
#   CMP_CERT_DOMAINS="example.com www.example.com"  Additional domains (primary still prompted)
#   CMP_CERT_HTTP_FALLBACK=1                Attempt standalone HTTP-01 on DNS failure
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
  warn "Node.js not found Î“Ã‡Ã´ attempting automatic install (20.x LTS)."
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

color "Downloading release ${TAG}..."
# Use a temporary directory for download and extraction
TMP_DIR=$(mktemp -d)
curl -fsSL "$TARBALL_URL" | tar -xz -C "$TMP_DIR" --strip-components=1 || die "Failed to download or extract release tarball."

color "Moving application files to ${APP_DIR}..."
# Use rsync to move files, which handles existing directories gracefully
rsync -a "$TMP_DIR/" "$APP_DIR/" || die "Failed to move files to ${APP_DIR}"
rm -rf "$TMP_DIR"

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

# Database preparation (PostgreSQL local assumed)
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
ALL_DOMAINS=("$DOMAIN" "${EXTRA_DOMAINS[@]}")
build_domain_args() { for host in "${ALL_DOMAINS[@]}"; do printf -- " -d %s" "$host"; done; }

CERT_OK=0
if [ "${CMP_SKIP_CERT:-}" = "1" ]; then
  warn "Skipping certificate issuance per CMP_SKIP_CERT=1"
else
  if [ ! -f "$CERT_PRIMARY_PATH" ]; then
    color "Requesting certificate (DNS-01 Cloudflare) for: ${ALL_DOMAINS[*]}"
    # Ensure dns-cloudflare plugin present (Debian/Ubuntu best-effort)
    if ! certbot plugins 2>/dev/null | grep -q dns-cloudflare; then
      if command -v apt-get >/dev/null 2>&1; then
        warn "dns-cloudflare plugin missing Î“Ã‡Ã´ attempting apt install..."
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
      if [ "${CMP_CERT_HTTP_FALLBACK:-}" = "1" ]; then
        warn "Attempting HTTP-01 fallback (standalone)..."
        # Stop backend to free :80 if running
        systemctl stop $BACKEND_SERVICE 2>/dev/null || true
        set +e
        certbot certonly --standalone $(build_domain_args) -m "$LE_EMAIL" --preferred-challenges http --agree-tos --non-interactive
        FB_EXIT=$?
        set -e
        if [ $FB_EXIT -ne 0 ]; then
          warn "HTTP-01 fallback also failed (exit $FB_EXIT). Proceeding without TLS."
        else
          color "HTTP-01 fallback succeeded"
          CERT_OK=1
        fi
      else
        warn "Certificate issuance failed (DNS-01) and fallback disabled. Proceeding without TLS."
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
      color "Installing nginx..."
      
      # Wait for dpkg locks to be released (max 300 seconds)
      local waited=0
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
    color "Configuring nginx for $DOMAIN..."
    mkdir -p /var/www/letsencrypt
    NCONF="/etc/nginx/sites-available/cmp-$DOMAIN.conf"
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
    if nginx -t; then
      systemctl restart nginx
      color "nginx configured and restarted"
    else
      err "nginx configuration test failed; please review $NCONF"
    fi
  fi
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
