#!/bin/bash
set -euo pipefail

OWNER="koyan04"
REPO="customer-management-portal"
APP_DIR="/srv/cmp"

# ────────────────────────────────────────────────────────────────────────────
# Global state & cleanup trap
# ────────────────────────────────────────────────────────────────────────────
ACTIVE_SWAP_FILE=""
TMP_DIR=""

cleanup() {
  local exit_code=$?
  if [ -n "$ACTIVE_SWAP_FILE" ] && [ -f "$ACTIVE_SWAP_FILE" ]; then
    swapoff "$ACTIVE_SWAP_FILE" 2>/dev/null || true
    rm -f "$ACTIVE_SWAP_FILE" 2>/dev/null || true
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# Proactively clean up any stale swap files left by previous failed runs
for old_swap in /tmp/cmp-build-swap* /var/tmp/cmp-build-swap* "${APP_DIR}/cmp-build-swap*" /cmp-build-swap*; do
  if [ -f "$old_swap" ]; then
    swapoff "$old_swap" 2>/dev/null || true
    rm -f "$old_swap" 2>/dev/null || true
  fi
done

# Filesystem helper: test if a directory is mounted on tmpfs/ramfs
is_ram_fs() {
  local dir="${1:-/tmp}"
  [ -d "$dir" ] || return 1
  if command -v stat >/dev/null 2>&1; then
    local fstype
    fstype=$(stat -f -c %T "$dir" 2>/dev/null || echo "")
    case "$fstype" in
      tmpfs|ramfs|devtmpfs) return 0 ;;
    esac
  fi
  if command -v df >/dev/null 2>&1; then
    local dftype
    dftype=$(df -T "$dir" 2>/dev/null | awk 'NR==2 {print $2}' || echo "")
    case "$dftype" in
      tmpfs|ramfs|devtmpfs) return 0 ;;
    esac
  fi
  return 1
}

# Ensure safe base directory for temporary files (prefer disk if /tmp is tmpfs/full)
UPDATE_TEMP_BASE="/tmp"
TMP_AVAIL_KB=$(df -P -k /tmp 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
if is_ram_fs "/tmp" || [ "${TMP_AVAIL_KB:-0}" -lt 204800 ]; then
  if [ -d "/var/tmp" ] && [ -w "/var/tmp" ] && ! is_ram_fs "/var/tmp"; then
    UPDATE_TEMP_BASE="/var/tmp"
    export TMPDIR="/var/tmp"
  elif [ -d "$APP_DIR" ] && [ -w "$APP_DIR" ]; then
    UPDATE_TEMP_BASE="$APP_DIR"
    export TMPDIR="$APP_DIR"
  fi
fi

BACKUP_DIR="${UPDATE_TEMP_BASE}/cmp_backup_$(date +%Y%m%d_%H%M%S)"

echo "=== Customer Management Portal Update ==="
echo ""

# Fetch latest release tag
echo "→ Fetching latest release from GitHub..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" | grep '"tag_name":' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')
if [ -z "$LATEST_TAG" ] || [ "$LATEST_TAG" = "null" ]; then
    echo "ERROR: Could not fetch latest release"
    exit 1
fi
echo "  Latest release: $LATEST_TAG"
echo ""

# Show current version
if [ ! -d "$APP_DIR" ]; then
    echo ""
    echo "ERROR: No existing installation found at $APP_DIR."
    echo ""
    echo "update-vps.sh only UPDATES an already-installed portal."
    echo "For a fresh server, use the installer instead:"
    echo ""
    echo "    curl -fsSL https://raw.githubusercontent.com/${OWNER}/${REPO}/main/scripts/bootstrap.sh | sudo bash"
    echo ""
    echo "Aborting without making any changes."
    exit 1
fi
echo "→ Current version:"
if [ -f "$APP_DIR/VERSION" ]; then
    cat "$APP_DIR/VERSION"
else
    echo "  Unknown (VERSION file not found)"
fi
echo ""

# Require node/npm before touching anything (prevents half-installs)
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo ""
    echo "ERROR: node / npm not found on this server."
    echo "Install Node.js first, or use the installer which handles it:"
    echo ""
    echo "    curl -fsSL https://raw.githubusercontent.com/${OWNER}/${REPO}/main/scripts/bootstrap.sh | sudo bash"
    echo ""
    echo "Aborting without making any changes."
    exit 1
fi

# Backup current installation (exclude node_modules to avoid filling RAM/tmpfs)
echo "→ Creating backup at $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"
if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude='*/node_modules' "$APP_DIR/" "$BACKUP_DIR/cmp/"
else
    cp -r "$APP_DIR" "$BACKUP_DIR/cmp"
fi

# Also backup avatar files separately (critical user data)
if [ -d "$APP_DIR/backend/public/uploads" ]; then
    echo "  → Backing up avatar files..."
    mkdir -p "$BACKUP_DIR/uploads"
    cp -r "$APP_DIR/backend/public/uploads/"* "$BACKUP_DIR/uploads/" 2>/dev/null || true
    echo "  ✓ Avatar files backed up"
fi

echo "  ✓ Backup created"
echo ""

# Backup database
echo "→ Backing up database..."
if sudo -u postgres pg_dump cmp > "$BACKUP_DIR/database.sql" 2>/dev/null; then
    echo "  ✓ Database backed up to $BACKUP_DIR/database.sql"
else
    echo "  ⚠ Database backup failed (continuing anyway)"
fi
echo ""

# Stop services
echo "→ Stopping services..."
systemctl stop cmp-backend cmp-telegram-bot || true
echo "  ✓ Services stopped"
echo ""

# Download and extract tarball
echo "→ Downloading release $LATEST_TAG..."
TMP_DIR=$(mktemp -d "${UPDATE_TEMP_BASE}/cmp_dl_XXXXXX" 2>/dev/null || mktemp -d)
TARBALL_URL="https://github.com/${OWNER}/${REPO}/archive/refs/tags/${LATEST_TAG}.tar.gz"
if ! curl -fsSL "$TARBALL_URL" | tar -xz -C "$TMP_DIR" --strip-components=1; then
    echo "ERROR: Failed to download or extract tarball"
    systemctl start cmp-backend cmp-telegram-bot || true
    exit 1
fi
echo "  ✓ Downloaded and extracted"
echo ""

# Update files (preserve .env and logos)
echo "→ Updating application files..."
# Backup critical files
cp "$APP_DIR/backend/.env" "$TMP_DIR/backend/.env"
if [ -d "$APP_DIR/backend/public/logos" ]; then
    mkdir -p "$TMP_DIR/backend/public/logos"
    cp -r "$APP_DIR/backend/public/logos/"* "$TMP_DIR/backend/public/logos/" || true
fi

# Preserve avatar files in uploads directory
if [ -d "$APP_DIR/backend/public/uploads" ]; then
    echo "  → Preserving avatar files..."
    mkdir -p "$TMP_DIR/backend/public/uploads"
    cp -r "$APP_DIR/backend/public/uploads/"* "$TMP_DIR/backend/public/uploads/" || true
fi

# Use rsync to update files
rsync -a "$TMP_DIR/" "$APP_DIR/" --exclude='Public_Release' --delete
rm -rf "$TMP_DIR"
echo "  ✓ Files updated"
echo ""

# Install backend dependencies
echo "→ Installing backend dependencies..."
cd "$APP_DIR/backend"
npm install --production
echo "  ✓ Backend dependencies installed"
echo ""

# Run migrations
echo "→ Running database migrations..."
cd "$APP_DIR/backend"
if ! node run_migrations.js; then
    echo "  ✗ Migrations failed"
    echo ""
    echo "ERROR: Database migration failed. Rolling back..."
    systemctl start cmp-backend cmp-telegram-bot || true
    exit 1
fi
echo "  ✓ Migrations completed"
echo ""

# Build frontend
echo "→ Building frontend..."
cd "$APP_DIR/frontend"
npm install

# Check available memory and create swap if needed
SWAP_CREATED=0
SWAP_FILE=""
if [ -f /proc/meminfo ]; then
  TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)
  TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
  SWAP_FREE_KB=$(grep SwapFree /proc/meminfo 2>/dev/null | awk '{print $2}' || echo 0)

  if [ "$TOTAL_MEM_MB" -lt 2048 ] && [ "$SWAP_FREE_KB" -lt 1048576 ]; then
    echo "  ⚠ Low memory (${TOTAL_MEM_MB}MB RAM, $((SWAP_FREE_KB / 1024))MB free swap) — preparing build swap..."
    
    for candidate in "$APP_DIR/cmp-build-swap" "/var/tmp/cmp-build-swap" "/cmp-build-swap"; do
      parent="$(dirname "$candidate")"
      [ -d "$parent" ] || continue
      [ -w "$parent" ] || continue
      is_ram_fs "$parent" && continue

      avail_kb=$(df -P -k "$parent" 2>/dev/null | awk 'NR==2 {print $4}' || echo 0)
      if [ "$avail_kb" -ge 3670016 ]; then
        SWAP_SIZE_MB=1536
        SWAP_FILE="$candidate"
        break
      elif [ "$avail_kb" -ge 2306867 ]; then
        SWAP_SIZE_MB=1024
        SWAP_FILE="$candidate"
        break
      elif [ "$avail_kb" -ge 1572864 ]; then
        SWAP_SIZE_MB=512
        SWAP_FILE="$candidate"
        break
      fi
    done

    if [ -n "$SWAP_FILE" ]; then
      ACTIVE_SWAP_FILE="$SWAP_FILE"
      echo "  → Allocating temporary ${SWAP_SIZE_MB}MB swap at $SWAP_FILE..."
      if dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MB" status=none 2>/dev/null; then
        chmod 600 "$SWAP_FILE" 2>/dev/null || true
        if mkswap "$SWAP_FILE" >/dev/null 2>&1; then
          if swapon "$SWAP_FILE" 2>/dev/null; then
            echo "  ✓ Temporary ${SWAP_SIZE_MB}MB swap activated"
            SWAP_CREATED=1
          else
            echo "  ⚠ swapon failed or restricted (e.g. unprivileged container) — proceeding without swap"
            rm -f "$SWAP_FILE" 2>/dev/null || true
            ACTIVE_SWAP_FILE=""
            SWAP_FILE=""
          fi
        else
          echo "  ⚠ mkswap failed — proceeding without swap"
          rm -f "$SWAP_FILE" 2>/dev/null || true
          ACTIVE_SWAP_FILE=""
          SWAP_FILE=""
        fi
      else
        echo "  ⚠ dd failed to allocate swap — proceeding without swap"
        rm -f "$SWAP_FILE" 2>/dev/null || true
        ACTIVE_SWAP_FILE=""
        SWAP_FILE=""
      fi
    else
      echo "  ⚠ No suitable disk-backed location with sufficient free space found — proceeding without swap"
    fi
  elif [ "$TOTAL_MEM_MB" -lt 2048 ]; then
    echo "  ✓ System already has $((SWAP_FREE_KB / 1024))MB free swap — no temporary swap needed"
  fi
fi

# Build with memory limit
if [ "$SWAP_CREATED" -eq 1 ] || [ "${SWAP_FREE_KB:-0}" -gt 500000 ] || [ "${TOTAL_MEM_MB:-0}" -ge 2048 ]; then
  export NODE_OPTIONS="--max-old-space-size=1536"
else
  export NODE_OPTIONS="--max-old-space-size=768"
fi
npm run build
unset NODE_OPTIONS

# Remove temporary swap if created
if [ "$SWAP_CREATED" -eq 1 ] && [ -n "$SWAP_FILE" ]; then
  swapoff "$SWAP_FILE" 2>/dev/null || true
  rm -f "$SWAP_FILE" 2>/dev/null || true
  ACTIVE_SWAP_FILE=""
  echo "  ✓ Temporary swap removed"
fi

echo "  ✓ Frontend built"
echo ""

# Ensure key server configs directory exists
mkdir -p "$APP_DIR/configs"

# Re-apply TLS repair and renewal hook after updates in case the vhost or hook drifted.
if [ -x "$APP_DIR/scripts/quick-fix-keyserver-tls.sh" ]; then
    echo "→ Re-applying TLS and keyserver quick-fix..."
    bash "$APP_DIR/scripts/quick-fix-keyserver-tls.sh" || true
    echo "  ✓ Quick-fix checked"
    echo ""
fi

# Start services
echo "→ Starting services..."
systemctl start cmp-backend
sleep 2
systemctl start cmp-telegram-bot
echo "  ✓ Services started"
echo ""

# Verify update
echo "→ Verifying update..."
sleep 3
NEW_VERSION=$(cat "$APP_DIR/VERSION" 2>/dev/null || echo "Unknown")
echo "  New version: $NEW_VERSION"

# Health check
echo ""
echo "→ Health check..."
HEALTH=$(curl -s http://127.0.0.1:3001/api/health || echo "FAILED")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "  ✓ Backend is healthy"
    VERSION=$(echo "$HEALTH" | grep -o '"appVersion":"[^"]*"' | cut -d'"' -f4)
    echo "  Running version: $VERSION"
else
    echo "  ⚠ Health check failed - check logs:"
    echo "    journalctl -u cmp-backend -n 50"
fi
echo ""

# Service status
echo "→ Service status:"
systemctl status cmp-backend --no-pager -l | head -5
echo ""
systemctl status cmp-telegram-bot --no-pager -l | head -5
echo ""

echo "=== Update Complete ==="
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""
echo "To view logs:"
echo "  journalctl -u cmp-backend -f"
echo "  journalctl -u cmp-telegram-bot -f"
echo ""
echo "To rollback (if needed):"
echo "  systemctl stop cmp-backend cmp-telegram-bot"
echo "  rm -rf $APP_DIR"
echo "  cp -r $BACKUP_DIR/cmp $APP_DIR"
echo "  sudo -u postgres psql cmp < $BACKUP_DIR/database.sql"
echo "  systemctl start cmp-backend cmp-telegram-bot"
echo ""
