# v1.9.16 — Server Monitor Slide-Over & Navbar UI/UX Polish

## What's New

### 1. Real-Time Server Monitor Slide-Over Panel
- **Dashboard Slide-Over Panel**:
  - Added a dedicated Server Monitor icon button (`<FaDesktop />`) in the top dashboard refresh controls bar (admin-accessible).
  - Opens a full slide-over panel with smooth slide-in animation, backdrop overlay, and keyboard (`Escape`) / backdrop-click dismissal.
- **Real-Time Host Telemetry Backend**:
  - `GET /api/admin/control/system-monitor`: Returns real-time host resource metrics with cross-platform fallbacks:
    - **CPU**: Utilization percentage, active core & thread counts, CPU model, clock speed, and rolling averages/peaks.
    - **RAM & SWAP**: Used, total, and free memory in bytes and percentages, with running averages and peak records.
    - **Disk Storage**: Partition capacity and usage for root partition (`/`) via `df -B1 /`.
    - **Network Speed & Volume**: Real-time upload and download transfer rates (Bytes/s), peak speed, and cumulative bytes sent and received.
    - **Active Sockets**: Total, TCP, and UDP connection counts via `ss -s`.
    - **Uptime**: CMP application process uptime (`process.uptime()`) and host operating system uptime (`os.uptime()`).
    - **Process Panel**: Node.js worker RSS memory usage and thread metrics.
    - **Server IP Address**: Primary host IP with an eye privacy toggle (`Show`/`Hide`) and one-click copy to clipboard.
- **Interactive Monitoring Controls**:
  - Live polling toggle (Pause/Play) with selectable polling intervals (2s, 5s, 10s).
  - Manual telemetry refresh button with spinning state animation.
  - One-click CMP backend service restart trigger (`POST /api/admin/control/service/restart`).
  - Embedded system log modal (`GET /api/admin/control/system-logs`) displaying recent `journalctl -u cmp-backend` output.
- **Full Theme Adaptation (Dark Mode & Light Mode)**:
  - Slide-over panel adapts dynamically to the active app theme (`:root` dark palette vs `body.theme-light`).
  - SVG sparklines, dual-line charts, grid lines, cards, buttons, badges, and modal frames seamlessly reflect light and dark mode in real time via dynamic mutation observation.

### 2. Navbar Menus UI/UX Bug Fixes
- **Avatar Dropdown Jump / Pop Animation Fixed**:
  - Resolved horizontal jumping glitch caused by mismatched `@keyframes menu-pop` translation; implemented `@keyframes avatar-menu-pop` with `transform-origin: top right; transform: translateY(-6px) scale(0.98)` to `translateY(0) scale(1)`.
- **Complete Light Theme Support for Avatar Menu**:
  - Fixed unstyled dark box in light mode; added frosted glass background, matching arrow pointer borders, dark-green text, and active radio item styling.
- **Active Navigation State for Generator Routes**:
  - Highlighted the Key navbar icon when visiting `/key-manager`, `/yaml-generator`, or `/json-generator`.
  - Highlighted the active generator item inside the dropdown menu.
- **Unified Button Sizing & Alignment**:
  - Matched `.key-icon-btn` padding, line-height, and box-sizing to standard `.nav-link` elements.
- **Flicker-Free Hover Transitions**:
  - Added an invisible pseudo-element bridge (`::after`) across the 8px hover gap, preventing accidental menu closure when moving the cursor from button to dropdown.
- **Mobile & Touch Improvements**:
  - Made the entire avatar container clickable and keyboard-accessible (`role="button"`, `tabIndex={0}`, Enter/Space key support).
  - Anchored the generators dropdown to the right edge (`right: 0`) on small screens (<720px) to prevent viewport clipping.
- **Route Navigation Auto-Close**:
  - Open dropdown menus now automatically close when navigating between routes.

---

## Upgrade Notes
- No database migrations are required.
- Upgrades can be performed via the Web UI Live Update or via `scripts/update-vps.sh`.
