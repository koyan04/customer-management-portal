#!/usr/bin/env bash
set -euo pipefail

# Bootstrap script for "dummy" users: installs prerequisites then runs project installer
# Supported: Debian/Ubuntu. For other distros, manually install dependencies first.
# Usage:
#  curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/bootstrap.sh | sudo bash
# or download, inspect, and run.

OWNER="koyan04"
REPO="customer-management-portal"
FALLBACK_TAG="v1.0.14"

fetch_latest_tag() {
  local latest=""
  latest=$(curl -fsSL "https://api.github.com/repos/${OWNER}/${REPO}/releases/latest" \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name" *: *"([^"]+)".*/\1/' || true)
  if [ -n "$latest" ]; then
    echo "$latest"
    return 0
  fi
  latest=$(curl -fsSL "https://api.github.com/repos/${OWNER}/${REPO}/tags?per_page=1" \
    | grep -m1 '"name"' \
    | sed -E 's/.*"name" *: *"([^"]+)".*/\1/' || true)
  if [ -n "$latest" ]; then
    echo "$latest"
    return 0
  fi
  echo "$FALLBACK_TAG"
}

TAG="${CMP_BOOTSTRAP_TAG_OVERRIDE:-$(fetch_latest_tag)}"
INSTALLER_URL="https://raw.githubusercontent.com/${OWNER}/${REPO}/${TAG}/scripts/install.sh"

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
