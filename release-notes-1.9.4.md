# v1.9.4 — JSON Generator XHTTP/REALITY Packing Fix

## What's New

### JSON Generator — XHTTP and REALITY Compatibility
- VLESS xhttp nodes now preserve `xhttp-opts` during import/export
- `extra` payloads are preserved so the packed JSON matches the working xray-client URI shape
- REALITY metadata is kept in sync for xhttp nodes, including `pbk`, `sid`, and `spx`
- Domain remapping now updates xhttp host fields as well as SNI/servername

## Bug Fixes

- Fixed JSON output so xhttp connections that work as single-line URIs also work when saved as packed JSON
- Prevented xhttp and REALITY fields from being dropped during generator round-trips

## Upgrade Notes

No database migrations or backend configuration changes are required.

## Verification

- Confirm a VLESS xhttp URI still imports and exports correctly
- Confirm the app reports `cmp ver 1.9.4`