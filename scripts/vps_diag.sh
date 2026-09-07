#!/bin/bash
set -euo pipefail

echo "--- JOURNAL (last 80) ---"
journalctl -u cmp-backend -n 80 --no-pager || true

echo "--- DB CHECK ---"
DB_HOST=$(grep -E '^DB_HOST=' /srv/cmp/backend/.env | cut -d= -f2-)
DB_USER=$(grep -E '^DB_USER=' /srv/cmp/backend/.env | cut -d= -f2-)
DB_NAME=$(grep -E '^DB_NAME=' /srv/cmp/backend/.env | cut -d= -f2-)
DB_PASSWORD=$(grep -E '^DB_PASSWORD=' /srv/cmp/backend/.env | cut -d= -f2-)
export PGPASSWORD="$DB_PASSWORD"

psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT MAX(id) AS max_id FROM domains;"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT last_value, is_called FROM domains_id_seq;"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c "SELECT id, domain, server, service, unlimited FROM domains ORDER BY id DESC LIMIT 10;"
