#!/bin/bash
set -e

# TLS Certificate Fix Script
# Helps diagnose and fix TLS/SSL certificate issues
# Usage: ./fix-tls.sh [domain]

echo "=== TLS Certificate Fix Script ==="
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root (use sudo)" 
   exit 1
fi

# Load environment variables if they exist
DOMAIN=""
if [ -f /srv/cmp/.env ]; then
    source /srv/cmp/.env 2>/dev/null || true
    # Try to get domain from environment
    DOMAIN="${DOMAIN_NAME:-}"
fi

# Check if domain provided as argument
if [ -n "$1" ]; then
    DOMAIN="$1"
fi

# Try to detect domain from nginx config
if [ -z "$DOMAIN" ] && [ -f /etc/nginx/sites-available/cmp ]; then
    DOMAIN=$(grep -oP 'server_name \K[^;]+' /etc/nginx/sites-available/cmp | head -1 | xargs)
fi

# Function to check port accessibility
check_port() {
    local port=$1
    if ss -tulpn | grep -q ":${port} "; then
        echo "✓ Port ${port} is listening"
        return 0
    else
        echo "✗ Port ${port} is NOT listening"
        return 1
    fi
}

# Function to test external port connectivity
test_external_port() {
    local domain=$1
    local port=$2
    echo "Testing external connectivity to ${domain}:${port}..."
    
    # Try to get the public IP
    public_ip=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "unknown")
    echo "Public IP: ${public_ip}"
    
    # Check if domain resolves to this server
    domain_ip=$(dig +short "${domain}" A | tail -n1)
    echo "Domain ${domain} resolves to: ${domain_ip}"
    
    if [ "$public_ip" != "$domain_ip" ] && [ "$domain_ip" != "" ]; then
        echo "⚠️  WARNING: Domain does not point to this server!"
        echo "   Domain IP: ${domain_ip}"
        echo "   Server IP: ${public_ip}"
        return 1
    fi
    
    # Test with timeout
    if timeout 5 bash -c "echo > /dev/tcp/${domain}/${port}" 2>/dev/null; then
        echo "✓ Port ${port} is accessible externally"
        return 0
    else
        echo "✗ Port ${port} is NOT accessible externally"
        return 1
    fi
}

# Diagnostic checks
echo "Step 1: Running diagnostic checks..."
echo ""

# Check if nginx is installed and running
if systemctl is-active --quiet nginx; then
    echo "✓ Nginx is running"
    nginx_running=true
else
    echo "✗ Nginx is not running"
    nginx_running=false
fi

# Check if certbot is installed
if command -v certbot &> /dev/null; then
    echo "✓ Certbot is installed"
    certbot_installed=true
else
    echo "✗ Certbot is not installed"
    certbot_installed=false
fi

# Check listening ports
echo ""
echo "Checking ports..."
port_80_ok=false
port_443_ok=false
check_port 80 && port_80_ok=true
check_port 443 && port_443_ok=true

echo ""
echo "Step 2: Identify the issue"
echo ""

# Check if we have a domain
if [ -z "$DOMAIN" ]; then
    # Check if stdin is a terminal (not piped)
    if [ -t 0 ]; then
        read -p "Enter your domain name: " DOMAIN
    else
        echo "Error: Domain not detected and script is running in non-interactive mode"
        echo ""
        echo "Solutions:"
        echo "  1. Download and run locally:"
        echo "     wget https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/fix-tls.sh"
        echo "     chmod +x fix-tls.sh"
        echo "     sudo ./fix-tls.sh YOUR_DOMAIN"
        echo ""
        echo "  2. Pass domain as argument:"
        echo "     curl -fsSL https://...fix-tls.sh | sudo bash -s YOUR_DOMAIN"
        echo ""
        echo "  3. Set DOMAIN_NAME in /srv/cmp/.env"
        echo ""
        exit 1
    fi
fi

if [ -z "$DOMAIN" ]; then
    echo "Error: Domain name is required"
    exit 1
fi

echo "Using domain: ${DOMAIN}"
echo ""

# Check if it's a dynamic DNS domain
if [[ "$DOMAIN" =~ \.(dpdns|no-ip|duckdns|dynu|freedns)\. ]]; then
    echo ""
    echo "⚠️  DETECTED: Dynamic DNS domain (${DOMAIN})"
    echo ""
    echo "Dynamic DNS domains cannot use Cloudflare DNS-01 challenge."
    echo "You must use HTTP-01 challenge, which requires:"
    echo "  1. Port 80 must be open and accessible from the internet"
    echo "  2. Domain must resolve to this server's public IP"
    echo "  3. No firewall blocking incoming connections on port 80"
    echo ""
    is_dynamic_dns=true
else
    is_dynamic_dns=false
fi

# Test external connectivity
echo ""
test_external_port "$DOMAIN" 80
port_80_external=$?

echo ""
echo "Step 3: Choose a solution"
echo ""
echo "Available options:"
echo ""
echo "1) Retry certificate with HTTP-01 challenge (requires port 80 open)"
echo "2) Configure firewall to allow ports 80 and 443"
echo "3) Use HTTP mode without TLS (not recommended for production)"
echo "4) Manual certificate setup instructions"
echo "5) Exit"
echo ""

# Determine if we're interactive
if [ -t 0 ]; then
    read -p "Choose an option (1-5): " choice
else
    echo "Non-interactive mode detected."
    echo ""
    
    # Check if certificates already exist
    if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
        echo "✓ Certificate already exists for ${DOMAIN}"
        echo ""
        read -p "Reconfigure nginx with existing certificate? (y/N): " reconfig </dev/tty || reconfig="y"
        
        if [[ "$reconfig" =~ ^[Yy]$ ]]; then
            choice=1
        else
            echo "Exiting. Certificate exists but not reconfigured."
            exit 0
        fi
    else
        # Auto-select option based on situation
        if [ "$port_80_external" -eq 0 ]; then
            echo "Port 80 is accessible. Automatically attempting certificate generation (option 1)..."
            choice=1
        else
            echo "Port 80 is not accessible. Firewall configuration needed (option 2)..."
            echo ""
            read -p "Configure firewall now? (Y/n): " answer </dev/tty || answer="y"
            
            if [[ "$answer" =~ ^[Nn]$ ]]; then
                echo "Exiting. Please configure firewall manually."
                exit 1
            else
                choice=2
            fi
        fi
    fi
fi

case $choice in
    1)
        echo ""
        echo "Attempting certificate generation with HTTP-01..."
        
        # Stop nginx temporarily
        if [ "$nginx_running" = true ]; then
            echo "Stopping nginx temporarily..."
            systemctl stop nginx
        fi
        
        # Stop backend temporarily
        systemctl stop cmp-backend 2>/dev/null || true
        
        # Try standalone HTTP-01
        echo "Running certbot in standalone mode..."
        certbot certonly --standalone --non-interactive --agree-tos \
            --email "${EMAIL:-admin@${DOMAIN}}" \
            -d "$DOMAIN" \
            --preferred-challenges http
        
        cert_result=$?
        
        if [ $cert_result -eq 0 ]; then
            echo ""
            echo "✓ Certificate obtained successfully!"
            
            # Configure nginx
            if [ "$nginx_running" = true ]; then
                echo "Configuring nginx with TLS..."
                cat > /etc/nginx/sites-available/cmp << EOF
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}
EOF
                
                ln -sf /etc/nginx/sites-available/cmp /etc/nginx/sites-enabled/
                nginx -t && systemctl restart nginx
                
                echo ""
                echo "✓ Nginx configured with TLS"
                echo ""
                echo "Your portal is now accessible at: https://${DOMAIN}"
            fi
        else
            echo ""
            echo "✗ Certificate generation failed"
            echo ""
            echo "Common causes:"
            echo "  1. Port 80 is blocked by firewall"
            echo "  2. Domain does not resolve to this server"
            echo "  3. Another service is using port 80"
            echo ""
            echo "Check the certbot logs: /var/log/letsencrypt/letsencrypt.log"
        fi
        
        # Start services
        systemctl start cmp-backend
        [ "$nginx_running" = true ] && systemctl start nginx
        ;;
        
    2)
        echo ""
        echo "Configuring firewall (ufw)..."
        
        # Install ufw if not present
        if ! command -v ufw &> /dev/null; then
            echo "Installing ufw..."
            apt-get update && apt-get install -y ufw
        fi
        
        # Configure firewall
        echo "Allowing SSH, HTTP, and HTTPS..."
        ufw allow 22/tcp comment 'SSH'
        ufw allow 80/tcp comment 'HTTP'
        ufw allow 443/tcp comment 'HTTPS'
        
        # Enable firewall (ask for confirmation)
        echo ""
        echo "⚠️  WARNING: Enabling firewall will block all other incoming connections"
        
        if [ -t 0 ]; then
            read -p "Do you want to enable the firewall now? (y/N): " enable_fw
        else
            # Use /dev/tty to read even when piped
            read -p "Do you want to enable the firewall now? (y/N): " enable_fw </dev/tty || enable_fw="y"
        fi
        
        if [[ "$enable_fw" =~ ^[Yy]$ ]]; then
            ufw --force enable
            echo "✓ Firewall enabled"
            ufw status
            echo ""
            echo "Firewall configured. Now attempting certificate generation..."
            sleep 2
            
            # Automatically try to get certificate after firewall setup
            echo ""
            echo "Attempting certificate generation with HTTP-01..."
            
            # Stop nginx temporarily
            if [ "$nginx_running" = true ]; then
                echo "Stopping nginx temporarily..."
                systemctl stop nginx
            fi
            
            # Stop backend temporarily
            systemctl stop cmp-backend 2>/dev/null || true
            
            # Try standalone HTTP-01
            echo "Running certbot in standalone mode..."
            certbot certonly --standalone --non-interactive --agree-tos \
                --email "${EMAIL:-admin@${DOMAIN}}" \
                -d "$DOMAIN" \
                --preferred-challenges http
            
            cert_result=$?
            
            if [ $cert_result -eq 0 ]; then
                echo ""
                echo "✓ Certificate obtained successfully!"
                
                # Configure nginx
                if [ "$nginx_running" = true ]; then
                    echo "Configuring nginx with TLS..."
                    cat > /etc/nginx/sites-available/cmp << EOF
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}
EOF
                    
                    ln -sf /etc/nginx/sites-available/cmp /etc/nginx/sites-enabled/
                    nginx -t && systemctl restart nginx
                    
                    echo ""
                    echo "✓ Nginx configured with TLS"
                    echo ""
                    echo "Your portal is now accessible at: https://${DOMAIN}"
                fi
            else
                echo ""
                echo "✗ Certificate generation failed"
                echo ""
                echo "Check the certbot logs: /var/log/letsencrypt/letsencrypt.log"
            fi
            
            # Start services
            systemctl start cmp-backend
            [ "$nginx_running" = true ] && systemctl start nginx
        else
            echo "Firewall rules added but not enabled"
            echo "Enable manually with: sudo ufw enable"
            echo "Then retry option 1 to get the certificate"
        fi
        ;;
        
    3)
        echo ""
        echo "Configuring HTTP mode (no TLS)..."
        
        if [ "$nginx_running" = true ]; then
            cat > /etc/nginx/sites-available/cmp << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
            
            ln -sf /etc/nginx/sites-available/cmp /etc/nginx/sites-enabled/
            nginx -t && systemctl restart nginx
            
            echo "✓ Nginx configured for HTTP"
            echo ""
            echo "⚠️  Your portal is accessible at: http://${DOMAIN}"
            echo "⚠️  WARNING: This is NOT secure for production use!"
        else
            echo "Nginx is not running. Backend is accessible at http://${DOMAIN}:3001"
        fi
        ;;
        
    4)
        echo ""
        echo "=== Manual Certificate Setup Instructions ==="
        echo ""
        echo "If automatic certificate generation fails, you can:"
        echo ""
        echo "Option A: Use a different ACME client"
        echo "  Try acme.sh (works better with dynamic DNS):"
        echo "    curl https://get.acme.sh | sh"
        echo "    ~/.acme.sh/acme.sh --issue --standalone -d ${DOMAIN}"
        echo ""
        echo "Option B: Get certificate from SSL provider"
        echo "  1. Get a free certificate from ZeroSSL or SSL.com"
        echo "  2. Place files in /etc/letsencrypt/live/${DOMAIN}/"
        echo "  3. Run this script again and choose option 1"
        echo ""
        echo "Option C: Use Cloudflare Origin Certificate"
        echo "  If your domain uses Cloudflare:"
        echo "  1. Generate Origin Certificate in Cloudflare dashboard"
        echo "  2. Set SSL mode to 'Full' in Cloudflare"
        echo "  3. Install certificate on this server"
        echo ""
        echo "Option D: Port forwarding"
        echo "  If behind a router/firewall:"
        echo "  1. Forward port 80 and 443 to this server"
        echo "  2. Ensure your public IP matches domain resolution"
        echo "  3. Run this script again and choose option 1"
        echo ""
        ;;
        
    5)
        echo "Exiting..."
        exit 0
        ;;
        
    *)
        echo "Invalid option"
        exit 1
        ;;
esac

echo ""
echo "=== TLS Fix Script Complete ==="
