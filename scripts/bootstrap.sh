#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for "dummy" users: installs prerequisites then runs project installer
# Supported: Debian/Ubuntu. For other distros, manually install dependencies first.
# Usage:
#  curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.3/scripts/bootstrap.sh | sudo bash
# or download, inspect, and run.

TAG="v1.0.3"
INSTALLER_URL="https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/${TAG}/scripts/install.sh"

if [ "${EUID}" -ne 0 ]; then
  echo "Please run as root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl openssl python3 python3-pip postgresql postgresql-contrib certbot python3-certbot-dns-cloudflare ca-certificates

# Ensure curl is present for installer
command -v curl >/dev/null 2>&1 || { echo "curl missing after install" >&2; exit 1; }

# Fetch installer to a temp file so prompts can read from TTY
tmp_installer="$(mktemp -t cmp-install-XXXX.sh)"
curl -fsSL "${INSTALLER_URL}" -o "$tmp_installer"
chmod +x "$tmp_installer"
"$tmp_installer"
rm -f "$tmp_installer"
