const zlib = require('zlib');
const { isZipBuffer, extractZipEntries, parseKeyBackupZip, extractDatabaseSnapshotFromZip } = require('../utils/keyBackupZip');

/**
 * Minimal ZIP builder for unit tests supporting both Store (0) and Deflate (8),
 * plus optional data descriptor (general purpose bit 3, matching streaming archiver).
 */
function buildZipBuffer(entries, { useDataDescriptor = false } = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content, compress = true } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const method = compress ? 8 : 0;
    const compBuf = compress ? zlib.deflateRawSync(rawBuf) : rawBuf;
    const flags = useDataDescriptor ? 0x0008 : 0x0000;

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(0, 14); // crc32 (not checked by parser)
    localHeader.writeUInt32LE(useDataDescriptor ? 0 : compBuf.length, 18);
    localHeader.writeUInt32LE(useDataDescriptor ? 0 : rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const parts = [localHeader, nameBuf, compBuf];
    if (useDataDescriptor) {
      const dd = Buffer.alloc(16);
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(0, 4);
      dd.writeUInt32LE(compBuf.length, 8);
      dd.writeUInt32LE(rawBuf.length, 12);
      parts.push(dd);
    }

    // Central directory header (46 bytes + name)
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(flags, 8);
    cdHeader.writeUInt16LE(method, 10);
    cdHeader.writeUInt32LE(0, 16);
    cdHeader.writeUInt32LE(compBuf.length, 20);
    cdHeader.writeUInt32LE(rawBuf.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt32LE(offset, 42);

    const entryBlock = Buffer.concat(parts);
    localParts.push(entryBlock);
    centralParts.push(Buffer.concat([cdHeader, nameBuf]));
    offset += entryBlock.length;
  }

  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

describe('keyBackupZip utility', () => {
  test('parses Telegram cmp-keys-backup ZIP archive (including streaming data descriptors)', () => {
    const zipBuf = buildZipBuffer(
      [
        {
          name: 'manifest.json',
          content: JSON.stringify({
            kind: 'cmp-keys-and-keyserver-backup',
            version: 1,
            created_at: '2026-11-25T17:30:04.129Z',
            key_file_count: 3,
            database_snapshot_included: true,
          }),
        },
        {
          name: 'keyserver/config.json',
          content: JSON.stringify({
            port: 8088,
            secretKey: 'sec-123',
            configDir: '/srv/cmp/configs',
            autoStart: true,
            publicDomain: 'key.example.com',
          }),
        },
        {
          name: 'keyserver/token_map.json',
          content: JSON.stringify({
            byToken: { tok1: 'user1.yaml' },
            byFile: { 'user1.yaml': 'tok1' },
          }),
        },
        { name: 'keyserver/keys/user1.yaml', content: 'proxies: []\n', compress: true },
        { name: 'keyserver/keys/user2.json', content: '{"inbounds":[]}', compress: false },
        { name: 'keyserver/keys/user2.json.meta.json', content: '{"note":"meta"}' },
        { name: 'keyserver/keys/ignored.exe', content: 'ignored binary' },
        { name: 'database.json', content: '{"type":"db-backup-v1"}' },
      ],
      { useDataDescriptor: true }
    );

    expect(isZipBuffer(zipBuf)).toBe(true);
    const parsed = parseKeyBackupZip(zipBuf);

    expect(parsed.version).toBe(1);
    expect(parsed.createdAt).toBe('2026-11-25T17:30:04.129Z');
    expect(parsed.config).toEqual({
      port: 8088,
      secretKey: 'sec-123',
      configDir: '/srv/cmp/configs',
      autoStart: true,
      publicDomain: 'key.example.com',
    });
    expect(parsed.tokenMap).toEqual({
      byToken: { tok1: 'user1.yaml' },
      byFile: { 'user1.yaml': 'tok1' },
    });
    expect(parsed.hasDatabaseSnapshot).toBe(true);
    expect(parsed.files.map((f) => f.filename).sort()).toEqual([
      'user1.yaml',
      'user2.json',
      'user2.json.meta.json',
    ]);
    expect(parsed.files.find((f) => f.filename === 'user1.yaml').content).toBe('proxies: []\n');
    expect(parsed.files.find((f) => f.filename === 'user2.json').content).toBe('{"inbounds":[]}');
  });

  test('supports a zipped Key Manager JSON backup bundle as fallback', () => {
    const zipBuf = buildZipBuffer([
      {
        name: 'keymanager-backup-2026-11-26.json',
        content: JSON.stringify({
          version: 1,
          createdAt: '2026-11-26T00:00:00.000Z',
          config: { port: 8088 },
          tokenMap: { byToken: {}, byFile: {} },
          files: [{ filename: 'a.yaml', content: 'proxies: []' }],
        }),
      },
    ]);

    const parsed = parseKeyBackupZip(zipBuf);
    expect(parsed.version).toBe(1);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].filename).toBe('a.yaml');
  });

  test('rejects invalid ZIP buffers and ZIPs without keyserver backup data', () => {
    expect(isZipBuffer(Buffer.from('not a zip'))).toBe(false);
    expect(() => extractZipEntries(Buffer.from('not a zip'))).toThrow(/Invalid ZIP/);

    const unrelatedZip = buildZipBuffer([{ name: 'readme.txt', content: 'hello world' }]);
    expect(() => parseKeyBackupZip(unrelatedZip)).toThrow(/no keyserver backup files found/i);
    expect(extractDatabaseSnapshotFromZip(unrelatedZip)).toBeNull();
  });

  test('extracts database.json from Telegram backup ZIP', () => {
    const zipBuf = buildZipBuffer([
      {
        name: 'database.json',
        content: JSON.stringify({
          created_at: '2026-11-25T17:30:04.000Z',
          servers: [{ id: 1, server_name: 'SG1' }],
          users: [],
        }),
      },
    ]);
    const db = extractDatabaseSnapshotFromZip(zipBuf);
    expect(db).toEqual({
      created_at: '2026-11-25T17:30:04.000Z',
      servers: [{ id: 1, server_name: 'SG1' }],
      users: [],
    });
  });
});
