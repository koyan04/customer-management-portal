# Release Notes v1.0.12

Date: 2025-11-10

## Installer Robustness Hotfix
Some environments reported a shell parse error near `else` during the Nginx prompt when executing the installer via a pipe. This release simplifies and hardens the prompt logic:

- Uses a TTY-aware prompt with a sane default when non-interactive.
- Avoids fragile condition parsing that could trip certain shells.

There are no functional changes besides improved reliability. All migration and JWT improvements from v1.0.10–v1.0.11 remain.

### Files Changed
- `scripts/install.sh`
- `scripts/install.sha256.baseline`
- `CHANGELOG.md`
- `VERSION`
- `README.md`

### Integrity
- scripts/install.sh SHA256: `4d71a95ddf992e246d731b8971845d7d277702ac13c88207ff6d0ed44f538c89`

### Usage
Pinned one-liner (direct installer):
```bash
sudo bash -lc "curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.12/scripts/install.sh | bash"
```

Or force tag checkout explicitly:
```bash
sudo bash -lc "CMP_CHECKOUT_REF=v1.0.12 curl -fsSL https://raw.githubusercontent.com/koyan04/customer-management-portal/v1.0.12/scripts/install.sh | bash"
```
