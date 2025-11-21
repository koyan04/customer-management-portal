# Release Notes: v1.0.16

**Release Date:** 2025-11-17

This is a hotfix release to address a critical issue in the public installation scripts.

---

### 🐛 Bug Fixes

*   **Installation Script:** The `install.sh` and `bootstrap.sh` scripts have been updated to download a release tarball (`.tar.gz`) instead of using `git clone`. This resolves an issue where the installer would incorrectly prompt for GitHub credentials, even on public repositories. This change makes the installation process more robust and reliable for anonymous public installs.
