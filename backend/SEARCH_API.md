# Global Search API

The backend exposes a global user search endpoint used by the frontend Search page.

- GET `/api/users/search`
  - Query params:
    - `q` (string, required, min length 2): search term against `account_name` across all servers visible to the requester.
    - `fuzzy` (optional, `1` to enable): includes close matches/typos. If the `pg_trgm` extension is unavailable, the API transparently falls back to a broadened/prefix pattern search.
  - Auth: Bearer token required.
  - Response: `200 OK` with an array of user records including:
    - `id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, server_id, server_name, status`
    - `status` is computed by the server (`active | soon | expired`) using end‑of‑day cutoff semantics for `expire_date`.

Notes:
- Results are filtered to servers the requester can access.
- When `fuzzy=1` is provided and `similarity()` is available, trigram similarity is used; otherwise, a safe fallback ensures user‑friendly matches.
