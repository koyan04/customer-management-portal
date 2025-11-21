### Fixed
- Removed pg_dump \restrict token from migration causing 'invalid message format' error on fresh installations.

### Added (v1.1.7)
- Temporary PostgreSQL trust fallback for blocked superuser access; automatic revert.

### Security
- Trust scope local + 127.0.0.1; removed post-install.

### Checksums
SHA256 (tar.gz): 6EEC52A7888B8A4118C7F109982C86028B887BC2ED528A0A5597CB04973194B2
SHA256 (zip):    4773F05EF09EBC98CD215B5A08764FEC57862C122D42148A79C14ED5FB10FA8C
