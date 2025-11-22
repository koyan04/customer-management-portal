#!/usr/bin/env bash
set -euo pipefail

# Manage backend and bot services for Customer Management Portal
# Usage: ./scripts/service-control.sh start|stop|restart|status

BACKEND_SERVICE="cmp-backend.service"
BOT_SERVICE="cmp-telegram-bot.service"

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 start|stop|restart|status"
  exit 2
fi

ACTION="$1"

run_systemctl() {
  local cmd="$1" svc="$2"
  if command -v systemctl >/dev/null 2>&1; then
    if [ "$EUID" -ne 0 ]; then
      sudo systemctl "$cmd" "$svc"
    else
      systemctl "$cmd" "$svc"
    fi
    return $?
  fi
  return 1
}

run_pm2() {
  local cmd="$1" name="$2"
  if command -v pm2 >/dev/null 2>&1; then
    case "$cmd" in
      start) pm2 start "$name" || true ;;
      stop) pm2 stop "$name" || true ;;
      restart) pm2 restart "$name" || true ;;
      status) pm2 list | grep -E "\b${name}\b" || true ;;
    esac
    return 0
  fi
  return 1
}

echo "Service control: $ACTION"

# Backend service control
if run_systemctl "$ACTION" "$BACKEND_SERVICE"; then
  echo "systemd: $BACKEND_SERVICE $ACTION completed"
else
  # some pm2 setups use the name without .service
  SHORT_BACKEND="${BACKEND_SERVICE%.service}"
  if run_pm2 "$ACTION" "$SHORT_BACKEND"; then
    echo "pm2: $SHORT_BACKEND $ACTION completed"
  else
    echo "Warning: neither systemctl nor pm2 handled backend service ($BACKEND_SERVICE)"
  fi
fi

# Bot service control (telegram bot)
if run_systemctl "$ACTION" "$BOT_SERVICE"; then
  echo "systemd: $BOT_SERVICE $ACTION completed"
else
  SHORT_BOT="${BOT_SERVICE%.service}"
  if run_pm2 "$ACTION" "$SHORT_BOT"; then
    echo "pm2: $SHORT_BOT $ACTION completed"
  else
    echo "Note: bot service ($BOT_SERVICE) not found in systemd or pm2; this may be optional"
  fi
fi

exit 0
