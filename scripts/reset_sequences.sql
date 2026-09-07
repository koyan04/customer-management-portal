SELECT setval('domains_id_seq', COALESCE((SELECT MAX(id) FROM domains), 1));
SELECT setval('servers_id_seq', COALESCE((SELECT MAX(id) FROM servers), 1));
SELECT setval('server_keys_id_seq', COALESCE((SELECT MAX(id) FROM server_keys), 1));
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));
