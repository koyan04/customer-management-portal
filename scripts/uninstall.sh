#!/usr/bin/env bash
set -euo pipefail

# Customer Management Portal Uninstaller
# Version: v1.0.0
# Purpose: cleanly remove a Customer Management Portal installation from a server.
#
# By default this script is DESTRUCTIVE — it stops and disables services, removes
# systemd units/timers, nginx vhosts, Let's Encrypt certs, the Cloudflare creds
# file, the app directory (/srv/cmp), and (optionally) the PostgreSQL role + DB.
# You MUST confirm before anything is removed.
#
# Usage:
#   sudo bash uninstall.sh                     # interactive confirmation
#   sudo bash uninstall.sh --yes               # skip every confirmation
#   sudo bash uninstall.sh --keep-db           # never touch PostgreSQL
#   sudo bash uninstall.sh --keep-env          # keep .env files (in a backup dir too)
#   sudo bash uninstall.sh --purge-all         # app + nginx + certs + db
#   sudo bash uninstall.sh --help
#
# Flags (override prompts):
#   --yes | -y          Do not ask for confirmation; remove everything selected.
#   --purge-all         Select every removal category (app, nginx, certs, db, configs).
#   --keep-app          Do not remove the app directory (/srv/cmp).
#   --keep-nginx        Do not remove nginx vhosts / reload nginx.
#   --keep-certs        Do not remove Let's Encrypt certs or renewal configs.
#   --keep-configs      Do not remove /root/.cloudflare.ini and /usr/local/bin/cmp-post-renew.sh.
#   --keep-db           Do not drop the PostgreSQL database/role.
#   --keep-env          Copy .env files to /root/cmp-uninstall-backup before removal.
#   --dry-run           Show what would be done without changing anything.
#
# Requirements: bash, root, systemd (Linux), optional psql for DB drop.

APP_NAME="customer-management-portal"
APP_DIR="/srv/cmp"
BACKEND_DIR="$APP_DIR/backend"
ENV_FILE="$BACKEND_DIR/.env"
ROOT_ENV="$APP_DIR/.env"
CF_CREDS_FILE="/root/.cloudflare.ini"
RENEW_HOOK="/usr/local/bin/cmp-post-renew.sh"
SYSTEMD_DIR="/etc/systemd/system"
NGINX_AVAILABLE="/etc/nginx/sites-available"
NGINX_ENABLED="/etc/nginx/sites-enabled"
LETSENCRYPT_DIR="/etc/letsencrypt"
BACKUP_ROOT="/root/cmp-uninstall-backup"

# systemd units we manage
SERVICES=(cmp-backend.service cmp-telegram-bot.service cmp-worker.service)
TIMERS=(cmp-cert-expiry.timer cmp-matview-refresh.timer)
ONESHOOTS=(cmp-cert-expiry.service cmp-matview-refresh.service)

# Colors / helpers (same style as install.sh)
RESET() { [ -t 1 ] && printf '\033[0m'; }
color() { echo -e "\033[1;32m$1\033[0m"; }
warn()  { echo -e "\033[1;33m$1\033[0m"; }
err()   { echo -e "\033[1;31m$1\033[0m"; }
info()  { echo -e "\033[1;36m$1\033[0m"; }
dim()   { echo -e "\033[2m$1\033[0m"; }
divider() { echo -e "\033[1;34m────────────────────────────────────────────────────────\033[0m"; }
banner() { divider; info "$1"; divider; }
section() { echo -e "\033[1;36m▸ $1\033[0m"; }
ok()   { echo -e "\033[1;32m ✔ $1\033[0m"; }
skip() { echo -e "\033[2m - $1\033[0m"; }

die() { err "ERROR: $1"; exit 1; }
require_root() { [ "$(id -u)" -eq 0 ] || die "Run as root (sudo bash uninstall.sh)"; }

# Whether a specific systemd unit exists
unit_exists() { [ -e "$SYSTEMD_DIR/$1" ] || systemctl list-unit-files --no-legend 2>/dev/null | awk '{print $1}' | grep -qx "$1"; }

# Read a KEY=VALUE from an env file
env_get() { # env_file key
  local f="$1" k="$2"
  [ -f "$f" ] && awk -F= -v k="$k" '$1==k {print $2; exit}' "$f"
}

# ─────────────── Parse CLI args ───────────────
DRY_RUN=0
ASSUME_YES=0
DO_APP=1
DO_NGINX=1
DO_CERTS=1
DO_CONFIGS=1
DO_DB=1
DO_ENV_BACKUP=0

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    --yes|-y) ASSUME_YES=1;;
    --purge-all) DO_APP=1; DO_NGINX=1; DO_CERTS=1; DO_CONFIGS=1; DO_DB=1;;
    --keep-app) DO_APP=0;;
    --keep-nginx) DO_NGINX=0;;
    --keep-certs) DO_CERTS=0;;
    --keep-configs) DO_CONFIGS=0;;
    --keep-db) DO_DB=0;;
    --keep-env) DO_ENV_BACKUP=1;;
    --dry-run) DRY_RUN=1;;
    *) warn "Unknown argument: $arg (see --help)";;
  esac
done

require_root

banner "Customer Management Portal Uninstaller"
info "This will remove the installed portal, its services, nginx config, certs, and optionally the database."
dim "Use --help for options. Use --dry-run to preview without changing anything."
divider

# If nothing selected, behave like a full uninstall (unless explicit keep flags)
if [ "$DO_APP" -eq 0 ] && [ "$DO_NGINX" -eq 0 ] && [ "$DO_CERTS" -eq 0 ] && [ "$DO_CONFIGS" -eq 0 ] && [ "$DO_DB" -eq 0 ]; then
  DO_APP=1; DO_NGINX=1; DO_CERTS=1; DO_CONFIGS=1; DO_DB=1
fi

# Pre-flight: detect existing components
EXISTS_APP=$([ -d "$APP_DIR" ] && echo 1 || echo 0)
DB_NAME=$(env_get "$ENV_FILE" DB_DATABASE); [ -z "$DB_NAME" ] && DB_NAME=$(env_get "$ROOT_ENV" DB_DATABASE)
DB_USER=$(env_get "$ENV_FILE" DB_USER);   [ -z "$DB_USER" ]  && DB_USER=$(env_get "$ROOT_ENV" DB_USER)
DOMAIN=$(env_get "$ENV_FILE" DOMAIN_NAME)
KEYSERVER_DOMAIN=$(grep -o '"publicDomain"[[:space:]]*:[[:space:]]*"[^"]*"' "$BACKEND_DIR/data/keyserver.json" 2>/dev/null | sed -E 's/.*"publicDomain"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/' || true)

if [ "$EXISTS_APP" -eq 0 ]; then
  info "No app directory found at $APP_DIR."
  warn "Still cleaning up services, nginx, certs, and DB if they were configured manually."
fi

has_unit=""
for u in "${SERVICES[@]}" "${TIMERS[@]}" "${ONESHOOTS[@]}"; do
  if unit_exists "$u"; then has_unit=1; break; fi
done

# ─────────────── Summary & confirmation ───────────────
info ""
info "The following will be removed:"
[ "$DO_APP" -eq 1 ] && [ "$EXISTS_APP" -eq 1 ] && info "  • Application directory: $APP_DIR"
[ "$DO_APP" -eq 1 ] && [ "$EXISTS_APP" -eq 0 ] && skip "  • App directory not present: $APP_DIR"
[ -n "$has_unit" ] && info "  • systemd services/timers: ${SERVICES[*]} ${ONESHOOTS[*]} ${TIMERS[*]}" || skip "  • No systemd units found"
[ "$DO_NGINX" -eq 1 ] && info "  • Nginx vhosts for: ${DOMAIN:-<primary>} ${KEYSERVER_DOMAIN:-}" || skip "  • Kept: nginx configs"
[ "$DO_CERTS" -eq 1 ] && info "  • Let's Encrypt certs for: ${DOMAIN:-<primary>} ${KEYSERVER_DOMAIN:-}" || skip "  • Kept: certificates"
[ "$DO_CONFIGS" -eq 1 ] && info "  • Cloudflare creds ($CF_CREDS_FILE) + renew hook ($RENEW_HOOK)" || skip "  • Kept: cloudflare creds / renew hook"
[ "$DO_DB" -eq 1 ] && info "  • PostgreSQL database '${DB_NAME:-<unknown>}' and role '${DB_USER:-<unknown>}'" || skip "  • Kept: database"
[ "$DO_ENV_BACKUP" -eq 1 ] && info "  • .env files backed up to $BACKUP_ROOT" || true

if [ "$DRY_RUN" -eq 1 ]; then
  warn "── DRY RUN — no changes will be made ──"
  exit 0
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Type YES to proceed with uninstallation: " ans
  [ "$ans" = "YES" ] || die "Aborted (did not type YES)."
fi

confirm_db=0
if [ "$DO_DB" -eq 1 ]; then
  if [ "$ASSUME_YES" -eq 0 ]; then
    read -r -p "Drop PostgreSQL database '${DB_NAME:-unknown}' and role '${DB_USER:-unknown}'? This is irreversible [y/N]: " dbans
    case "$(echo "$dbans" | tr '[:upper:]' '[:lower:]')" in
      y|yes) confirm_db=1;;
      *) confirm_db=0;;
    esac
  else
    confirm_db=1
  fi
fi

# ─────────────── 1. Stop & disable systemd units ───────────────
section "Stopping and disabling systemd units"
for u in "${TIMERS[@]}" "${ONESHOOTS[@]}" "${SERVICES[@]}"; do
  if unit_exists "$u"; then
    systemctl stop "$u" 2>/dev/null || true
    systemctl disable "$u" 2>/dev/null || true
    ok "stopped & disabled $u"
  else
    skip "$u not present"
  fi
done
systemctl daemon-reload || true

# ─────────────── 2. Remove systemd unit files ───────────────
section "Removing systemd unit files"
for u in "${SERVICES[@]}" "${ONESHOOTS[@]}" "${TIMERS[@]}"; do
  if [ -f "$SYSTEMD_DIR/$u" ]; then
    rm -f "$SYSTEMD_DIR/$u"
    ok "removed $u"
  else
    skip "$u not found"
  fi
done
# Remove stale symlinks pointing at our units from /etc/systemd/system dependencies
find "$SYSTEMD_DIR" -maxdepth 1 -type l -lname "*cmp-*.service" -delete 2>/dev/null || true
find "$SYSTEMD_DIR" -maxdepth 1 -type l -lname "*cmp-*.timer" -delete 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed 2>/dev/null || true

# ─────────────── 3. Nginx vhosts ───────────────
if [ "$DO_NGINX" -eq 1 ] && command -v nginx >/dev/null 2>&1; then
  section "Removing nginx vhosts"
  VHOSTS=()
  [ -n "$DOMAIN" ] && VHOSTS+=("$NGINX_AVAILABLE/cmp-$DOMAIN.conf" "$NGINX_ENABLED/cmp-$DOMAIN.conf")
  [ -n "$KEYSERVER_DOMAIN" ] && VHOSTS+=("$NGINX_AVAILABLE/cmp-$KEYSERVER_DOMAIN.conf" "$NGINX_ENABLED/cmp-$KEYSERVER_DOMAIN.conf")
  # Also catch any remaining cmp- vhosts generically
  VHOSTS+=($(ls "$NGINX_AVAILABLE"/cmp-*.conf 2>/dev/null || true))
  VHOSTS+=($(ls "$NGINX_ENABLED"/cmp-*.conf 2>/dev/null || true))

  local_seen=()
  for v in "${VHOSTS[@]}"; do
    [ -z "$v" ] && continue
    # dedupe
    found=0
    for s in "${local_seen[@]}"; do [ "$s" = "$v" ] && found=1; done
    [ "$found" -eq 1 ] && continue
    local_seen+=("$v")
    [ -e "$v" ] || continue
    rm -f "$v"
    ok "removed $v"
  done

  if [ -d "$NGINX_ENABLED" ]; then
    # safety: delete stale symlinks to cmp-*.conf
    find "$NGINX_ENABLED" -maxdepth 1 -type l -lname "*cmp-*.conf" -delete 2>/dev/null || true
  fi

  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
    ok "nginx reloaded"
  else
    warn "nginx -t failed after vhost removal; not reloading. Review $(dirname "$NGINX_AVAILABLE")."
  fi
elif [ "$DO_NGINX" -eq 1 ]; then
  skip "nginx not installed; nothing to remove"
fi

# ─────────────── 4. Let's Encrypt certs ───────────────
if [ "$DO_CERTS" -eq 1 ]; then
  section "Removing Let's Encrypt certs"
  CERT_DOMAINS=()
  [ -n "$DOMAIN" ] && CERT_DOMAINS+=("$DOMAIN")
  [ -n "$KEYSERVER_DOMAIN" ] && CERT_DOMAINS+=("$KEYSERVER_DOMAIN")
  # fall back to scanning live dir for our domains when .env missing
  while IFS= read -r d; do CERT_DOMAINS+=("$d"); done < <(ls "$LETSENCRYPT_DIR/live" 2>/dev/null | sort -u | grep -E "^(cmp-|key\.|.*cmp.*)" || true)

  for d in "${CERT_DOMAINS[@]}"; do
    d="$(basename "$d")"
    for sub in live archive renewal; do
      p="$LETSENCRYPT_DIR/$sub/$d"
      if [ -e "$p" ]; then rm -rf "$p" && ok "removed $p"; fi
    done
    rc="$LETSENCRYPT_DIR/renewal/$d.conf"
    if [ -f "$rc" ]; then rm -f "$rc" && ok "removed $rc"; fi
  done
  # Remove deploy hook line that points at our renew hook (best-effort)
  if [ -d "$LETSENCRYPT_DIR/renewal" ]; then
    grep -rlF "cmp-post-renew.sh" "$LETSENCRYPT_DIR/renewal/" 2>/dev/null \
      | while read -r rc; do
          sed -i '\#cmp-post-renew.sh#d' "$rc" || true
        done || true
  fi
fi

# ─────────────── 5. Config files (cloudflare / renew hook) ───────────────
if [ "$DO_CONFIGS" -eq 1 ]; then
  section "Removing Cloudflare creds & renew hook"
  for p in "$CF_CREDS_FILE" "$RENEW_HOOK"; do
    if [ -e "$p" ]; then rm -f "$p" && ok "removed $p"; fi
  done
  # Remove leftover certbot cron/systemd if any installer added them
  rm -f /etc/systemd/system/cmp-cert-renew.service /etc/systemd/system/cmp-cert-renew.timer 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
fi

# ─────────────── 6. Backup env files (optional) ───────────────
if [ "$DO_ENV_BACKUP" -eq 1 ]; then
  section "Backing up .env files"
  mkdir -p "$BACKUP_ROOT"
  if [ -f "$ENV_FILE" ]; then cp -f "$ENV_FILE" "$BACKUP_ROOT/backend.env" && ok "backed up $ENV_FILE"; fi
  if [ -f "$ROOT_ENV" ]; then cp -f "$ROOT_ENV" "$BACKUP_ROOT/root.env" && ok "backed up $ROOT_ENV"; fi
  if [ -f "$BACKEND_DIR/data/keyserver.json" ]; then
    mkdir -p "$BACKUP_ROOT/data"
    cp -f "$BACKEND_DIR/data/keyserver.json" "$BACKUP_ROOT/data/keyserver.json" && ok "backed up keyserver.json"
  fi
fi

# ─────────────── 7. PostgreSQL DB drop ───────────────
if [ "$DO_DB" -eq 1 ] && [ "$confirm_db" -eq 1 ]; then
  section "Dropping PostgreSQL database & role"
  if command -v psql >/dev/null 2>&1; then
    if [ -z "$DB_NAME" ] && [ -z "$DB_USER" ]; then
      warn "Could not determine DB name/user (no .env). Skipping DB drop. Revoke manually if needed."
    else
      # Use local postgres superuser via sudo when available
      run_db() { if sudo -u postgres psql -qAt "$@" >/dev/null 2>&1; then true; else PGPASSWORD="" psql "$@" >/dev/null 2>&1; fi; }
      # Terminate connections to the database before dropping
      if [ -n "$DB_NAME" ]; then
        sudo -u postgres psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid<>pg_backend_pid();" >/dev/null 2>&1 || true
        if sudo -u postgres psql -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" >/dev/null 2>&1; then
          ok "dropped database $DB_NAME"
        else
          warn "Could not drop database $DB_NAME via postgres superuser; you may need to run manually."
        fi
      fi
      if [ -n "$DB_USER" ]; then
        if sudo -u postgres psql -d postgres -c "DROP ROLE IF EXISTS \"$DB_USER\";" >/dev/null 2>&1; then
          ok "dropped role $DB_USER"
        else
          warn "Could not drop role $DB_USER via postgres superuser; you may need to run manually."
        fi
      fi
    fi
  else
    skip "psql not installed; database not dropped"
  fi
else
  skip "database kept (per prompt or --keep-db)"
fi

# ─────────────── 8. Remove app directory ───────────────
if [ "$DO_APP" -eq 1 ]; then
  section "Removing application directory"
  if [ -d "$APP_DIR" ]; then
    if [ "$DO_ENV_BACKUP" -eq 0 ]; then
      warn "Removing $APP_DIR (including .env with DB credentials). Re-run with --keep-env to back these up first."
    fi
    rm -rf "$APP_DIR"
    ok "removed $APP_DIR"
  else
    skip "$APP_DIR not found"
  fi
fi

# ─────────────── 9. pm2 cleanup (best-effort) ───────────────
section "Cleaning up pm2 processes (if used)"
if command -v pm2 >/dev/null 2>&1; then
  for name in cmp-backend cmp-telegram-bot; do
    if pm2 describe "$name" >/dev/null 2>&1; then
      pm2 delete "$name" >/dev/null 2>&1 || true
      ok "pm2 deleted $name"
    fi
  done
  pm2 save >/dev/null 2>&1 || true
else
  skip "pm2 not installed"
fi

# ─────────────── 10. Remove leftover pg_hba.conf marker backups from installer ───────────────
section "Cleaning installer artifacts"
# Remove the "CMP TEMP TRUST" marker lines the installer may have added to pg_hba.conf
for hba in /etc/postgresql/*/*/pg_hba.conf; do
  [ -f "$hba" ] || continue
  if grep -q "# CMP TEMP TRUST" "$hba"; then
    grep -v "# CMP TEMP TRUST" "$hba" > "${hba}.cmpclean" && mv "${hba}.cmpclean" "$hba"
    ok "removed CMP TEMP TRUST marker from $hba"
  fi
done
# Remove pg_hba.conf backup files the installer created (keep the newest original untouched)
find /etc/postgresql -name "pg_hba.conf.bak.*" -delete 2>/dev/null || true
find /etc/postgresql -name "pg_hba.conf.cmp-backup.*" -delete 2>/dev/null || true

find /root -maxdepth 1 -name ".cloudflare.ini.bak.*" -delete 2>/dev/null || true

# ─────────────── Done ───────────────
divider
color "Uninstallation complete."
warn "The following were left untouched by design: Node.js, npm, nginx, PostgreSQL, certbot, and the system packages — remove them separately if desired (e.g. apt remove --purge nginx postgresql)."
[ "$DO_ENV_BACKUP" -eq 1 ] && info "Environment backup kept at: $BACKUP_ROOT"
divider