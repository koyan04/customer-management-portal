# v1.9.18 — Slide-Over Panel Stacking & Portal Layering Fix

## What's New

### 1. Slide-Over Panel React Portal Mounting
- **Mounted to `document.body` via `createPortal`**:
  - Resolved UI layering bug where `.main-header` (the top navbar with logo, titles, menu items, search, and avatar) was showing through / rendered on top of the Server Monitor slide-over drawer and its header.
  - Portaled `ServerMonitorSlideOver` directly into `document.body`, completely breaking out of any parent component stacking contexts.
  - Increased backdrop `z-index` to `99999` to ensure the slide-over overlay smoothly dims and covers the entire viewport including the application header.

### 2. Stacking Context Hygiene
- Removed artificial `z-index: 1` on `.main-content` to prevent any child modals and overlays from being trapped beneath the header.
- Elevated standard `.modal-backdrop` to `z-index: 10000` so modal dialogs consistently layer above `.main-header` (`z-index: 1000`).

---

## Upgrade Notes
- No database migrations are required.
- Upgrades can be performed via the Web UI Live Update or via:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/main/scripts/update-vps.sh | sudo bash
  ```
