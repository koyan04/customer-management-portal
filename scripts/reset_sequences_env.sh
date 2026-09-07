#!/bin/bash
set -euo pipefail

set -a
. /srv/cmp/backend/.env
set +a

export PGPASSWORD="$DB_PASSWORD"

psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 <<'SQL'
SELECT setval('domains_id_seq', COALESCE((SELECT MAX(id) FROM domains), 1));
SELECT setval('servers_id_seq', COALESCE((SELECT MAX(id) FROM servers), 1));
SELECT setval('server_keys_id_seq', COALESCE((SELECT MAX(id) FROM server_keys), 1));
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));
SQL

echo "--- verify ---"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 -c "SELECT MAX(id) AS max_id FROM domains;"
psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_DATABASE" -v ON_ERROR_STOP=1 -c "SELECT last_value, is_called FROM domains_id_seq;"

echo "Sequence reset complete on DB_DATABASE=$DB_DATABASE"
