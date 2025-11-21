### Added
- Temporary PostgreSQL trust fallback for blocked superuser access; automatic revert.

### Security
- Local-only trust scope (unix socket + 127.0.0.1) removed post-install.
- Original pg_hba.conf backed up with timestamp.

### Upgrade Notes
- No schema changes vs v1.1.6.
- Re-run installer to benefit from fallback if superuser password unknown.

### Checksums
SHA256 (tar.gz): 05BB6157666B24A8E7D0254E3104A18B4C8FC3D1EE99C735B9945A673722F1DB
SHA256 (zip):    61236D219AD211E76F54022D066ECC927F2C350DD21CE29F3EA367DC47F12206
