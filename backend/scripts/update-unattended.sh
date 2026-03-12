#!/bin/bash
# Unattended update for Customer Management Portal (GUI-triggered, no service stop)
# Signals the Node.js process to restart at the very end via RESTART_SIGNAL.
# Self-healing: auto-installs missing prerequisites, retries on build failure.

set -euo pipefail

OWNER="koyan04"
REPO="customer-management-portal"
APP_DIR="/srv/cmp"

# ────────────────────────────────────────────────────────────────────────────
# Helper: true when $1 looks like a version tag (v1.2.3 or 1.2.3)
# ────────────────────────────────────────────────────────────────────────────
is_valid_tag() { echo "${1:-}" | grep -qE '^v?[0-9]+\.[0-9]'; }

# ────────────────────────────────────────────────────────────────────────────
# Self-update: download the script that matches LATEST_TAG and exec it.
# This guarantees the running script is always current, regardless of what
# version is on the VPS disk. Skipped when already self-updated or when
# LATEST_TAG is not yet known (fallback path resolves it further below).
# ────────────────────────────────────────────────────────────────────────────
if [ -z "${CMP_SELF_UPDATED:-}" ] && is_valid_tag "${LATEST_TAG:-}"; then
  SCRIPT_URL="https://raw.githubusercontent.com/${OWNER}/${REPO}/${LATEST_TAG}/backend/scripts/update-unattended.sh"
  SELF_TMP=$(mktemp /tmp/cmp-updater-XXXXXX.sh)
  if curl -fsSL "$SCRIPT_URL" -o "$SELF_TMP" 2>/dev/null && [ -s "$SELF_TMP" ]; then
    chmod +x "$SELF_TMP"
    echo "→ Self-updating to ${LATEST_TAG} update script..."
    # exec replaces this process; CMP_SELF_UPDATED prevents an infinite loop.
    exec env CMP_SELF_UPDATED=1 LATEST_TAG="$LATEST_TAG" bash "$SELF_TMP"
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
# Prerequisites: ensure required tools are installed, auto-fix if missing
# ────────────────────────────────────────────────────────────────────────────
ensure_tool() {
  local tool="$1" pkg="${2:-$1}"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "  ⚠ '$tool' not found — installing $pkg..."
    if command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" 2>&1 | grep -v '^$' | tail -5 || true
    elif command -v yum >/dev/null 2>&1; then
      yum install -y -q "$pkg" 2>&1 | tail -5 || true
    fi
    if command -v "$tool" >/dev/null 2>&1; then
      echo "  ✓ $tool installed"
    else
      echo "  ✗ Could not install $tool (will proceed, some fallbacks may not work)"
    fi
  fi
}

echo "=== Customer Management Portal — Unattended Update ==="
echo ""
echo "→ Checking prerequisites..."
ensure_tool curl
ensure_tool jq
ensure_tool python3
ensure_tool rsync
echo "  ✓ Prerequisites OK"
echo ""

# ── Fetch latest release tag ───────────────────────────────────────────────
echo "→ Fetching latest release from GitHub..."

# Use pre-resolved tag from Node.js backend (passed as env var) when available
if is_valid_tag "${LATEST_TAG:-}"; then
  echo "  Latest release: $LATEST_TAG (pre-resolved by backend)"
else
  # Method 1: follow the /releases/latest redirect — no JSON parsing needed
  LATEST_TAG=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
    "https://github.com/${OWNER}/${REPO}/releases/latest" 2>/dev/null \
    | sed 's|.*/||' || true)

  if ! is_valid_tag "$LATEST_TAG"; then
    echo "  Redirect method failed, falling back to API..."
    API_RESPONSE=$(curl -fsSL \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" 2>/dev/null || true)

    LATEST_TAG=""
    if command -v jq >/dev/null 2>&1; then
      LATEST_TAG=$(printf '%s' "$API_RESPONSE" | jq -r '.tag_name // empty' 2>/dev/null || true)
    fi
    if ! is_valid_tag "$LATEST_TAG" && command -v python3 >/dev/null 2>&1; then
      LATEST_TAG=$(printf '%s' "$API_RESPONSE" | python3 -c \
        "import sys,json; d=json.load(sys.stdin); print(d.get('tag_name',''))" 2>/dev/null || true)
    fi
    if ! is_valid_tag "$LATEST_TAG"; then
      LATEST_TAG=$(printf '%s' "$API_RESPONSE" \
        | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' \
        || true)
    fi
  fi

  if ! is_valid_tag "$LATEST_TAG"; then
      echo "  ERROR: Could not determine latest release tag from GitHub"
      exit 1
  fi
  echo "  Latest release: $LATEST_TAG"
fi
echo ""

# ── Show current version ───────────────────────────────────────────────────
echo "→ Current version:"
if [ -f "$APP_DIR/VERSION" ]; then
    cat "$APP_DIR/VERSION"
else
    echo "  Unknown (VERSION file not found)"
fi
echo ""

# ── Backup database ────────────────────────────────────────────────────────
BACKUP_DIR="/tmp/cmp_update_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "→ Backing up database..."
if sudo -u postgres pg_dump cmp > "$BACKUP_DIR/database.sql" 2>/dev/null; then
    echo "  ✓ Database backed up to $BACKUP_DIR/database.sql"
else
    echo "  ⚠ Database backup skipped (pg_dump unavailable or failed)"
fi
echo ""

# ── Download release tarball ───────────────────────────────────────────────
echo "→ Downloading release $LATEST_TAG..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

TARBALL_URL="https://github.com/${OWNER}/${REPO}/archive/refs/tags/${LATEST_TAG}.tar.gz"
if ! curl -fsSL "$TARBALL_URL" | tar -xz -C "$TMP_DIR" --strip-components=1; then
    echo "  ERROR: Failed to download or extract release tarball"
    exit 1
fi
echo "  ✓ Downloaded and extracted"
echo ""

# ── Preserve critical files ────────────────────────────────────────────────
echo "→ Preserving critical files..."
[ -f "$APP_DIR/backend/.env" ] && cp "$APP_DIR/backend/.env" "$TMP_DIR/backend/.env"

# Preserve keyserver data (public domain, secret key, port settings)
if [ -d "$APP_DIR/backend/data" ]; then
    mkdir -p "$TMP_DIR/backend/data"
    cp -r "$APP_DIR/backend/data/"* "$TMP_DIR/backend/data/" 2>/dev/null || true
fi

# Preserve user-generated key/config files
if [ -d "$APP_DIR/configs" ]; then
    mkdir -p "$BACKUP_DIR/configs"
    cp -r "$APP_DIR/configs/"* "$BACKUP_DIR/configs/" 2>/dev/null || true
fi

if [ -d "$APP_DIR/backend/public/logos" ]; then
    mkdir -p "$TMP_DIR/backend/public/logos"
    cp -r "$APP_DIR/backend/public/logos/"* "$TMP_DIR/backend/public/logos/" 2>/dev/null || true
fi
if [ -d "$APP_DIR/backend/public/uploads" ]; then
    mkdir -p "$TMP_DIR/backend/public/uploads"
    cp -r "$APP_DIR/backend/public/uploads/"* "$TMP_DIR/backend/public/uploads/" 2>/dev/null || true
fi
echo "  ✓ Done"
echo ""

# ── Sync new application files (skip backend/public — we copy after build) ─
echo "→ Syncing application files..."
rsync -a "$TMP_DIR/" "$APP_DIR/" \
    --exclude='backend/public' \
    --exclude='backend/node_modules' \
    --exclude='frontend/node_modules' \
    --exclude='configs' \
    --exclude='backend/data' \
    --delete
echo "  ✓ Files synced"
echo ""

# ── Install backend dependencies ───────────────────────────────────────────
echo "→ Installing backend dependencies..."
cd "$APP_DIR/backend"
npm install --production 2>&1
echo "  ✓ Backend dependencies installed"
echo ""

# Ensure node / npm are accessible (guard for PATH issues)
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "  ⚠ node/npm not in PATH — attempting to fix..."
  # Common NVM / n / system locations
  for d in /usr/local/bin /usr/bin ~/.nvm/versions/node/*/bin; do
    [ -x "$d/node" ] && export PATH="$d:$PATH" && break
  done
  if ! command -v node >/dev/null 2>&1; then
    ensure_tool nodejs nodejs
    ensure_tool npm npm
  fi
  echo "  node: $(node --version 2>/dev/null || echo 'still not found')"
fi

# ── Run database migrations ────────────────────────────────────────────────
echo "→ Running database migrations..."
if ! node run_migrations.js; then
    echo "  ERROR: Database migrations failed — aborting update"
    exit 1
fi
echo "  ✓ Migrations completed"
echo ""

# ── Build frontend ─────────────────────────────────────────────────────────
echo "→ Installing frontend dependencies..."
cd "$APP_DIR/frontend"
# Force development mode so npm installs devDependencies (vite, etc.)
NODE_ENV=development npm install 2>&1
echo "  ✓ Frontend dependencies installed"
echo ""

echo "→ Building frontend..."
SWAP_CREATED=0
if [ -f /proc/meminfo ]; then
    TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    TOTAL_MEM_GB=$((TOTAL_MEM_KB / 1024 / 1024))
    if [ "$TOTAL_MEM_GB" -lt 2 ]; then
        echo "  ⚠ Low memory (${TOTAL_MEM_GB}GB) — creating temporary swap..."
        SWAP_FILE="/tmp/cmp-build-swap"
        dd if=/dev/zero of="$SWAP_FILE" bs=1M count=2048 status=none
        chmod 600 "$SWAP_FILE"
        mkswap "$SWAP_FILE" >/dev/null 2>&1
        swapon "$SWAP_FILE"
        SWAP_CREATED=1
    fi
fi

export NODE_OPTIONS="--max-old-space-size=1536"

# ── Build with automatic recovery on failure ───────────────────────────────
build_frontend() {
  NODE_ENV=development npm run build 2>&1
}

if ! build_frontend; then
  echo "  ⚠ Build failed — checking for missing devDependencies..."
  # Ensure vite and other devDependencies are installed regardless of NODE_ENV
  if ! node_modules/.bin/vite --version >/dev/null 2>&1; then
    echo "  ⚠ vite not found — running npm install --include=dev..."
    npm install --include=dev 2>&1
  fi
  echo "  → Retrying build..."
  if ! build_frontend; then
    echo "  ERROR: Frontend build failed after recovery attempt"
    unset NODE_OPTIONS
    exit 1
  fi
fi

unset NODE_OPTIONS

if [ "$SWAP_CREATED" -eq 1 ]; then
    swapoff "$SWAP_FILE" 2>/dev/null || true
    rm -f "$SWAP_FILE"
fi
echo "  ✓ Frontend built"
echo ""

# ── Deploy frontend build to backend/public ────────────────────────────────
echo "→ Deploying frontend to backend/public..."
mkdir -p "$APP_DIR/backend/public"
# Exclude user-generated directories so uploads/logos are never deleted by --delete
rsync -a --delete \
    --exclude='uploads' \
    --exclude='logos' \
    "$APP_DIR/frontend/dist/" "$APP_DIR/backend/public/"
echo "  ✓ Frontend deployed"
echo ""

# ── Explicitly restore logos and uploads from pre-update backup ────────────
# This is belt-and-suspenders: the rsync --exclude above should preserve these
# directories in-place, but the explicit copy here guarantees no data loss
# even if rsync exclude behavior differs across versions/environments.
echo "→ Restoring logos and uploads from backup..."
LOGO_RESTORE=0
UPLOAD_RESTORE=0
if [ -d "$TMP_DIR/backend/public/logos" ]; then
    mkdir -p "$APP_DIR/backend/public/logos"
    # Copy every file that isn't a .gitkeep placeholder
    find "$TMP_DIR/backend/public/logos" -maxdepth 1 -type f ! -name '.gitkeep' -exec cp -p {} "$APP_DIR/backend/public/logos/" \;
    LOGO_RESTORE=1
fi
if [ -d "$TMP_DIR/backend/public/uploads" ]; then
    mkdir -p "$APP_DIR/backend/public/uploads"
    find "$TMP_DIR/backend/public/uploads" -maxdepth 1 -type f ! -name '.gitkeep' -exec cp -p {} "$APP_DIR/backend/public/uploads/" \;
    UPLOAD_RESTORE=1
fi
if [ "$LOGO_RESTORE" -eq 1 ] || [ "$UPLOAD_RESTORE" -eq 1 ]; then
    echo "  ✓ Logos/uploads restored"
else
    echo "  ✓ No logos/uploads to restore"
fi
echo ""

# ── Restore configs (key files) backed up before rsync ────────────────────
if [ -d "$BACKUP_DIR/configs" ]; then
    mkdir -p "$APP_DIR/configs"
    cp -r "$BACKUP_DIR/configs/"* "$APP_DIR/configs/" 2>/dev/null || true
    echo "  ✓ Key configs restored"
fi

# ── Deploy/update systemd service file ────────────────────────────────────
SERVICE_SRC="$APP_DIR/backend/systemd/cmp-backend.service"
SERVICE_DEST="/etc/systemd/system/cmp-backend.service"
if [ -f "$SERVICE_SRC" ]; then
    echo "→ Updating systemd service file..."
    if cp "$SERVICE_SRC" "$SERVICE_DEST" 2>/dev/null; then
        systemctl daemon-reload
        echo "  ✓ Service file updated and daemon reloaded"
    else
        echo "  ⚠ Could not write to $SERVICE_DEST (read-only filesystem or permission denied) — skipping service file update"
        echo "    The existing service file will continue to be used."
    fi
    echo ""
else
    echo "  ⚠ cmp-backend.service not found in repo, skipping service file update"
fi

echo "=== Update complete! ==="
echo ""

# ── Schedule a clean service restart independent of this process tree ──────
# Using systemctl restart directly (rather than SIGTERM self-kill) ensures
# systemd fully controls the restart with proper ordering, dependency
# resolution, and no risk of hitting StartLimitBurst from failed self-kills.
echo "→ Scheduling service restart..."
if systemd-run --on-active=4 --collect /bin/systemctl restart cmp-backend >/dev/null 2>&1; then
    echo "  ✓ Restart scheduled via systemd-run (fires in 4s)"
else
    # Fallback: disowned background subshell (survives this script exiting)
    (sleep 4 && exec /bin/systemctl restart cmp-backend) </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
    echo "  ✓ Restart scheduled via background job (fires in 4s)"
fi
echo ""
echo "RESTART_SIGNAL"
