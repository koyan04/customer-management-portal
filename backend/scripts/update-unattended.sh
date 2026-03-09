#!/bin/bash
# Unattended update for Customer Management Portal (GUI-triggered, no service stop)
# Signals the Node.js process to restart at the very end via RESTART_SIGNAL.

set -euo pipefail

OWNER="koyan04"
REPO="customer-management-portal"
APP_DIR="/srv/cmp"

echo "=== Customer Management Portal — Unattended Update ==="
echo ""

# ── Fetch latest release tag ───────────────────────────────────────────────
echo "→ Fetching latest release from GitHub..."

is_valid_tag() { echo "$1" | grep -qE '^v?[0-9]+\.[0-9]'; }

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
NODE_ENV=development npm run build 2>&1
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
rsync -a --delete "$APP_DIR/frontend/dist/" "$APP_DIR/backend/public/"
echo "  ✓ Frontend deployed"
echo ""

# ── Restore configs (key files) backed up before rsync ────────────────────
if [ -d "$BACKUP_DIR/configs" ]; then
    mkdir -p "$APP_DIR/configs"
    cp -r "$BACKUP_DIR/configs/"* "$APP_DIR/configs/" 2>/dev/null || true
    echo "  ✓ Key configs restored"
fi

echo "=== Update complete! ==="
echo ""
echo "RESTART_SIGNAL"
