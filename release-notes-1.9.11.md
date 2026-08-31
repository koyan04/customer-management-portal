# v1.9.11 — Hide Disabled Users + Key Manager Menu Fix

## What's New

### Hide Disabled Users (Settings → General)
- Added a **Hide disabled users** checkbox under **Settings → General** (default: checked)
- When enabled, disabled users are hidden from the server user list and the dashboard tier users modal
- The setting is persisted server-side in `app_settings.general` and applies immediately across the app without a page reload
- Users can still view disabled accounts by selecting the **Disabled** status filter on a server page

### Key Manager Mobile Menu Fix
- Fixed the Key Manager mobile action menu so clicks on menu items no longer leak through to underlying rows or other page elements
- The popup now uses proper event shielding (`pointerdown`/`mousedown`), explicit `type="button"` items, and a safer stacking order
- The mobile table no longer relies on broad visible overflow, so the menu stays above neighboring cells without affecting layout

## Bug Fixes

- Key Manager: clicking a mobile menu item no longer triggers actions on the row or elements underneath the popup
- Key Manager: the popup menu now stays correctly layered above adjacent table cells

## Upgrade Notes

No database migrations are required. The new `hideDisabledUsers` setting defaults to enabled for existing installs.

## Verification

- Settings → General shows the **Hide disabled users** checkbox, checked by default
- Disabling a user hides them from the server user list; selecting the **Disabled** status filter reveals them
- On a mobile viewport, opening the Key Manager row menu and clicking an item performs only that action