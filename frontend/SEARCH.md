# Global User Search (Frontend)

Find users across all accessible servers from a single page.

- Open the Search page via the magnifying glass icon in the top banner.
- Type at least 2 characters; press Enter or click Search.
- Optional: enable the "Fuzzy" toggle to include close matches and typos.
- Desktop view shows richer columns: Account, Service, Server, Status, Expire, Contact, Remark, and Actions. The selection checkbox column is compact.
- Admins can multi‑select rows and use the "+1M" bulk action to extend selected users by one month (updates are applied sequentially with inline feedback).

Details:
- Fuzzy searches call the same endpoint with `?fuzzy=1` and gracefully fall back when the database extension isn’t available.
- Status chips indicate `ACTIVE`, `SOON` (expiring within ~24h), and `EXPIRED`.
- Column widths on desktop are tuned for readability: 3,15,7,20,7,10,7,10,21 (% for Select, Account, Service, Server, Status, Expire, Contact, Remark, Actions).

Troubleshooting:
- If no results appear, ensure you entered at least 2 characters.
- If authenticated requests fail, confirm your JWT token is valid (log in again).
- For bulk actions, ensure your user role is `ADMIN`.
