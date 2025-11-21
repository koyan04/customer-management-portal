# Release Notes: v1.0.17

**Release Date:** 2025-11-17

This is a hotfix release to address a critical issue in the public installation scripts.

---

### 🐛 Bug Fixes

*   **Installation Script:** The `bootstrap.sh` script has been simplified. It no longer attempts to fetch the "latest" release, which was causing it to download old, incorrect versions of the installer. The script is now hardcoded to download the installer from the exact version specified in the URL (`v1.0.17`). This guarantees that the correct, updated installation process is used, finally resolving the issue where the installer would incorrectly prompt for GitHub credentials.
