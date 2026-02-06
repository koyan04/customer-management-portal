#!/bin/bash

OWNER="koyan04"
REPO="customer-management-portal"
APP_DIR="/srv/cmp"
BACKUP_DIR="/tmp/cmp_backup_$(date +%Y%m%d_%H%M%S)"

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
echo "→ Current version:"
if [ -f "$APP_DIR/VERSION" ]; then
    cat "$APP_DIR/VERSION"
else
    echo "  Unknown (VERSION file not found)"
fi
echo ""

# Backup current installation
echo "→ Creating backup at $BACKUP_DIR..."
mkdir -p "$BACKUP_DIR"
cp -r "$APP_DIR" "$BACKUP_DIR/cmp"

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
TMP_DIR=$(mktemp -d)
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
node run_migrations.js
echo "  ✓ Migrations completed"
echo ""

# Build frontend
echo "→ Building frontend..."
cd "$APP_DIR/frontend"
npm install
npm run build
echo "  ✓ Frontend built"
echo ""

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
