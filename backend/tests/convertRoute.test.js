// Route-level test for POST /api/keyserver/convert.
//
// The auth middleware and the db pool are mocked so this exercises the real
// route handler (overwrite guard, token validation, filename sanitising,
// meta.json carry-over) without needing a live Postgres or an admin JWT.

const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Mocks (must be registered before the router is required) ───
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => next(),
  isAdmin: (req, res, next) => next(),
  isAdminOrServerAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: (req, res, next) => next(),
}));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'km-convert-'));

// Point the keyserver config at a throwaway directory.
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'keyserver.json');
const TOKEN_MAP_PATH = path.join(__dirname, '..', 'data', 'token_map.json');
const realConfig = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf-8') : null;
const realTokenMap = fs.existsSync(TOKEN_MAP_PATH) ? fs.readFileSync(TOKEN_MAP_PATH, 'utf-8') : null;

const setConfig = (dir) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    port: 8088, secretKey: 'k'.repeat(32), configDir: dir, autoStart: false,
  }, null, 2), 'utf-8');
};

const setTokenMap = (map) => {
  fs.writeFileSync(TOKEN_MAP_PATH, JSON.stringify(map, null, 2), 'utf-8');
};

const CLASH_YAML = `mixed-port: 7890
proxies:
  - name: A
    type: vmess
    server: a.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    alterId: 0
    cipher: auto
  - name: B
    type: trojan
    server: b.com
    port: 443
    password: p
    sni: b.com
    alpn:
      - h2
      - http/1.1
`;

const SINGBOX_JSON = JSON.stringify({
  outbounds: [
    { type: 'vmess', tag: 'proxy', server: 'a.com', server_port: 443, uuid: 'u-1' },
    { type: 'trojan', tag: 'B', server: 'b.com', server_port: 443, password: 'p',
      tls: { enabled: true, server_name: 'b.com', alpn: ['h2', 'http/1.1'] } },
    { type: 'direct', tag: 'direct' },
  ],
});

// Build the router AFTER mocks are in place.
let router;
let express;

const post = (routerRef, body) => new Promise((resolve) => {
  const req = { body, params: {}, query: {} };
  const res = {
    statusCode: 200,
    _payload: undefined,
    status(c) { this.statusCode = c; return this; },
    json(p) { this._payload = p; resolve({ status: this.statusCode, body: p }); return this; },
    send(p) { this._payload = p; resolve({ status: this.statusCode, body: p }); return this; },
  };
  const layer = routerRef.stack.find(l => l.route && l.route.path === '/convert');
  layer.route.stack[layer.route.stack.length - 1].handle(req, res);
});

beforeAll(() => {
  jest.resetModules();
  setConfig(TMP_DIR);
  setTokenMap({ byToken: {}, byFile: {} });
  express = require('express');
  router = require('../routes/keyserver');
});

afterAll(() => {
  if (realConfig) fs.writeFileSync(CONFIG_PATH, realConfig, 'utf-8');
  else if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  if (realTokenMap) fs.writeFileSync(TOKEN_MAP_PATH, realTokenMap, 'utf-8');
  else if (fs.existsSync(TOKEN_MAP_PATH)) fs.unlinkSync(TOKEN_MAP_PATH);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const writeCfg = (name, body) => fs.writeFileSync(path.join(TMP_DIR, name), body, 'utf-8');

beforeEach(() => {
  fs.readdirSync(TMP_DIR).forEach(f => fs.unlinkSync(path.join(TMP_DIR, f)));
  setTokenMap({ byToken: {}, byFile: {} });
});

describe('POST /convert — mode dispatch', () => {
  test('rejects a missing mode', async () => {
    const r = await post(router, {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/mode is required/);
  });

  test('rejects an unknown mode', async () => {
    const r = await post(router, { mode: 'yaml-to-pdf' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Unknown mode/);
  });

  test('404s on a missing source file', async () => {
    const r = await post(router, { mode: 'rename', filename: 'nope.yaml', newToken: 'a'.repeat(32) });
    expect(r.status).toBe(404);
  });
});

describe('POST /convert — yaml-to-json', () => {
  test('converts and registers a subscription token', async () => {
    writeCfg('src.yaml', CLASH_YAML);
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: 'out.json' });
    expect(r.status).toBe(200);
    expect(r.body.filename).toBe('out.json');
    expect(r.body.proxyCount).toBeGreaterThan(0);

    // proxyCount must count real proxies only, excluding the auto-added
    // selector / direct / block outbounds.
    const written = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'out.json'), 'utf-8'));
    const realProxies = written.outbounds.filter(o =>
      ['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2'].includes(o.type));
    expect(r.body.proxyCount).toBe(realProxies.length);
    expect(r.body.proxyCount).toBe(2);

    // A token must exist for the new file.
    const map = JSON.parse(fs.readFileSync(TOKEN_MAP_PATH, 'utf-8'));
    expect(map.byFile['out.json']).toBeTruthy();
    expect(map.byToken[map.byFile['out.json']]).toBe('out.json');
    expect(r.body.token).toBe(map.byFile['out.json']);
  });

  test('reports lossy conversions as warnings', async () => {
    writeCfg('src.yaml', `${CLASH_YAML}proxy-groups:\n  - name: G\n    type: select\n    proxies:\n      - A\nrules:\n  - MATCH,G\n`);
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: 'out.json' });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.warnings)).toBe(true);
    // proxy-groups now convert cleanly; only routing rules are unsupported.
    expect(r.body.warnings.join(' ')).toMatch(/rule/);
  });

  test('refuses to overwrite an existing file without the flag (409)', async () => {
    writeCfg('src.yaml', CLASH_YAML);
    writeCfg('out.json', 'EXISTING');
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: 'out.json' });
    expect(r.status).toBe(409);
    expect(r.body.conflict).toBe(true);
    expect(r.body.error).toMatch(/already exists/);
    // Untouched.
    expect(fs.readFileSync(path.join(TMP_DIR, 'out.json'), 'utf-8')).toBe('EXISTING');
  });

  test('overwrites when overwrite: true is set', async () => {
    writeCfg('src.yaml', CLASH_YAML);
    writeCfg('out.json', 'EXISTING');
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: 'out.json', overwrite: true });
    expect(r.status).toBe(200);
    expect(r.body.replaced).toBe(true);
    expect(fs.readFileSync(path.join(TMP_DIR, 'out.json'), 'utf-8')).not.toBe('EXISTING');
  });

  test('rejects a non-YAML source for yaml-to-json', async () => {
    writeCfg('src.json', SINGBOX_JSON);
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.json', newFilename: 'o.json' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/yaml-to-json needs/);
  });

  test('422s and writes nothing on unparseable YAML', async () => {
    writeCfg('bad.yaml', 'proxies:\n  - name: x\n   bad: [\n');
    const r = await post(router, { mode: 'yaml-to-json', filename: 'bad.yaml', newFilename: 'o.json' });
    expect(r.status).toBe(500);
    expect(fs.existsSync(path.join(TMP_DIR, 'o.json'))).toBe(false);
  });

  test('strips path traversal from the destination name', async () => {
    writeCfg('src.yaml', CLASH_YAML);
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: '../../etc/evil.json' });
    expect(r.status).toBe(200);
    expect(r.body.filename).toBe('evil.json');
    expect(fs.existsSync(path.join(TMP_DIR, 'evil.json'))).toBe(true);
  });

  test('carries .meta.json limits over to the converted file', async () => {
    writeCfg('src.yaml', CLASH_YAML);
    writeCfg('src.yaml.meta.json', JSON.stringify({ data_limit_gb: 50, expire_date: '2026-12-31' }));
    const r = await post(router, { mode: 'yaml-to-json', filename: 'src.yaml', newFilename: 'out.json' });
    expect(r.status).toBe(200);
    expect(r.body.metaCopied).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(TMP_DIR, 'out.json.meta.json'), 'utf-8'));
    expect(meta.data_limit_gb).toBe(50);
    expect(meta.expire_date).toBe('2026-12-31');
  });
});

describe('POST /convert — json-to-yaml', () => {
  test('converts and emits INLINE alpn', async () => {
    writeCfg('in.json', SINGBOX_JSON);
    const r = await post(router, { mode: 'json-to-yaml', filename: 'in.json', newFilename: 'out.yaml' });
    expect(r.status).toBe(200);
    const text = fs.readFileSync(path.join(TMP_DIR, 'out.yaml'), 'utf-8');
    expect(text).toMatch(/^ {4}alpn: \[h2, http\/1\.1\]$/m);
    expect(text).not.toMatch(/^ {4}alpn:\s*$/m);
  });

  test('rejects a non-JSON source for json-to-yaml', async () => {
    writeCfg('in.yaml', CLASH_YAML);
    const r = await post(router, { mode: 'json-to-yaml', filename: 'in.yaml', newFilename: 'o.yaml' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/json-to-yaml needs/);
  });

  test('rejects JSON that is not a sing-box config', async () => {
    writeCfg('in.json', '{"hello":"world"}');
    const r = await post(router, { mode: 'json-to-yaml', filename: 'in.json', newFilename: 'o.yaml' });
    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/outbounds/);
  });

  test('refuses to write Clash YAML into a .json destination (prevents corruption)', async () => {
    writeCfg('in.json', SINGBOX_JSON);
    const r = await post(router, { mode: 'json-to-yaml', filename: 'in.json', newFilename: 'in.json' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must end in \.yaml/);
    // The source must be left byte-identical.
    expect(fs.readFileSync(path.join(TMP_DIR, 'in.json'), 'utf-8')).toBe(SINGBOX_JSON);
  });

  test('rejects a destination whose extension contradicts the target format', async () => {
    writeCfg('in.json', SINGBOX_JSON);
    const r = await post(router, { mode: 'json-to-yaml', filename: 'in.json', newFilename: 'out.json' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must end in \.yaml/);
    expect(fs.existsSync(path.join(TMP_DIR, 'out.json'))).toBe(false);
  });
});

describe('POST /convert — rename', () => {
  test('rotates the token and keeps both map directions consistent', async () => {
    writeCfg('f.yaml', CLASH_YAML);
    const first = await post(router, { mode: 'rename', filename: 'f.yaml', newToken: '1'.repeat(32) });
    expect(first.status).toBe(200);

    const second = await post(router, { mode: 'rename', filename: 'f.yaml', newToken: '2'.repeat(32) });
    expect(second.status).toBe(200);
    expect(second.body.oldToken).toBe('1'.repeat(32));
    expect(second.body.newToken).toBe('2'.repeat(32));

    const map = JSON.parse(fs.readFileSync(TOKEN_MAP_PATH, 'utf-8'));
    expect(map.byToken['2'.repeat(32)]).toBe('f.yaml');
    expect(map.byFile['f.yaml']).toBe('2'.repeat(32));
    // The old token must be gone, not left dangling.
    expect(map.byToken['1'.repeat(32)]).toBeUndefined();
  });

  test('uppercase hex is normalised to lowercase', async () => {
    writeCfg('f.yaml', CLASH_YAML);
    const r = await post(router, { mode: 'rename', filename: 'f.yaml', newToken: 'AABBCCDDEEFF00112233445566778899' });
    expect(r.status).toBe(200);
    expect(r.body.newToken).toBe('aabbccddeeff00112233445566778899');
  });

  test.each([
    ['too short', 'abc'],
    ['non-hex', 'z'.repeat(32)],
    ['too long', 'a'.repeat(33)],
    ['empty', ''],
  ])('rejects an invalid token (%s)', async (_label, tok) => {
    writeCfg('f.yaml', CLASH_YAML);
    const r = await post(router, { mode: 'rename', filename: 'f.yaml', newToken: tok });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/32 hexadecimal/);
  });

  test('409s when the target token belongs to another file', async () => {
    writeCfg('a.yaml', CLASH_YAML);
    writeCfg('b.yaml', CLASH_YAML);
    await post(router, { mode: 'rename', filename: 'a.yaml', newToken: 'a'.repeat(32) });
    const r = await post(router, { mode: 'rename', filename: 'b.yaml', newToken: 'a'.repeat(32) });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already in use/);

    // Neither file may have been disturbed.
    const map = JSON.parse(fs.readFileSync(TOKEN_MAP_PATH, 'utf-8'));
    expect(map.byToken['a'.repeat(32)]).toBe('a.yaml');
    expect(map.byFile['b.yaml']).toBeUndefined();
  });

  test('400s when re-selecting the token the file already has', async () => {
    writeCfg('f.yaml', CLASH_YAML);
    await post(router, { mode: 'rename', filename: 'f.yaml', newToken: 'a'.repeat(32) });
    const r = await post(router, { mode: 'rename', filename: 'f.yaml', newToken: 'a'.repeat(32) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/already uses/);
  });

  test('renaming does not modify the config file itself', async () => {
    writeCfg('f.yaml', CLASH_YAML);
    const before = fs.readFileSync(path.join(TMP_DIR, 'f.yaml'), 'utf-8');
    await post(router, { mode: 'rename', filename: 'f.yaml', newToken: 'c'.repeat(32) });
    expect(fs.readFileSync(path.join(TMP_DIR, 'f.yaml'), 'utf-8')).toBe(before);
  });
});
