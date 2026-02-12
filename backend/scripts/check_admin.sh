#!/bin/bash
# Diagnostic script to check and fix missing admin accounts

echo "=== Admin Account Diagnostic ==="
echo ""

# Check if we're in the backend directory
if [ ! -f "db.js" ]; then
    echo "ERROR: Please run this from /srv/cmp/backend directory"
    echo "Usage: cd /srv/cmp/backend && bash check_admin.sh"
    exit 1
fi

# Check database connection
echo "→ Checking database connection..."
if ! node -e "require('./db').query('SELECT 1').then(() => { console.log('  ✓ Database connected'); process.exit(0); }).catch(e => { console.error('  ✗ Database connection failed:', e.message); process.exit(1); })"; then
    exit 1
fi
echo ""

# Check if admins table exists
echo "→ Checking admins table..."
if ! node -e "require('./db').query('SELECT COUNT(*) FROM admins').then(() => { console.log('  ✓ Admins table exists'); process.exit(0); }).catch(e => { console.error('  ✗ Admins table missing - run migrations first'); process.exit(1); })"; then
    echo ""
    echo "Fix: Run migrations first"
    echo "  cd /srv/cmp/backend && node run_migrations.js"
    exit 1
fi
echo ""

# Count existing admins
echo "→ Checking existing admin accounts..."
ADMIN_COUNT=$(node -e "require('./db').query('SELECT COUNT(*) as count FROM admins').then(r => { console.log(r.rows[0].count); process.exit(0); }).catch(e => { console.log('0'); process.exit(1); })")

if [ "$ADMIN_COUNT" = "0" ]; then
    echo "  ✗ No admin accounts found"
    echo ""
    echo "→ Creating admin account..."
    
    # Prompt for credentials
    read -p "  Admin username [admin]: " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}
    
    read -sp "  Admin password [admin123]: " ADMIN_PASS
    echo ""
    ADMIN_PASS=${ADMIN_PASS:-admin123}
    
    read -p "  Display name [Administrator]: " ADMIN_DISPLAY
    ADMIN_DISPLAY=${ADMIN_DISPLAY:-Administrator}
    
    # Run seedAdmin.js with environment variables
    export SEED_ADMIN_USERNAME="$ADMIN_USER"
    export SEED_ADMIN_PASSWORD="$ADMIN_PASS"
    export SEED_ADMIN_DISPLAY="$ADMIN_DISPLAY"
    
    if node seedAdmin.js; then
        echo "  ✓ Admin account created successfully"
        echo ""
        echo "→ Login credentials:"
        echo "  Username: $ADMIN_USER"
        echo "  Password: $ADMIN_PASS"
    else
        echo "  ✗ Failed to create admin account"
        exit 1
    fi
else
    echo "  ✓ Found $ADMIN_COUNT admin account(s)"
    echo ""
    echo "→ Existing accounts:"
    node -e "
        require('./db').query('SELECT id, username, display_name, role FROM admins ORDER BY id')
            .then(r => {
                r.rows.forEach(admin => {
                    console.log(\`  - \${admin.username} (\${admin.display_name}) - Role: \${admin.role}\`);
                });
                process.exit(0);
            })
            .catch(e => {
                console.error('  Error fetching accounts:', e.message);
                process.exit(1);
            });
    "
fi

echo ""
echo "→ Checking backend API..."
curl -s http://127.0.0.1:3001/api/health > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "  ✓ Backend API is responding"
    
    # Check version
    VERSION=$(curl -s http://127.0.0.1:3001/api/health | grep -o '"appVersion":"[^"]*"' | cut -d'"' -f4)
    if [ -n "$VERSION" ]; then
        echo "  Backend version: $VERSION"
    fi
else
    echo "  ✗ Backend API not responding"
    echo ""
    echo "Fix: Check if backend service is running"
    echo "  systemctl status cmp-backend"
    echo "  journalctl -u cmp-backend -n 50"
fi

echo ""
echo "=== Diagnostic Complete ==="
