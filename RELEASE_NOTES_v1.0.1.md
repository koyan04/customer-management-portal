# Customer Management Portal – v1.0.1

Patch release focusing on improved first-time installation ergonomics.

## Change
- Installer now auto-installs Node.js 20.x LTS if `node` is missing (Debian/Ubuntu via NodeSource)
  - Set `CMP_SKIP_NODE_AUTO_INSTALL=1` to disable auto-install and require preinstalled Node

## Install (updated one-liner)
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan-testpilot/customer-management-portal/v1.0.1/scripts/install.sh | bash"
```

## Changelog excerpt
See `CHANGELOG.md` entry for 1.0.1 (2025-11-10).
