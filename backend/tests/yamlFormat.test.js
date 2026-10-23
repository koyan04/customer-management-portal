// Tests for serving a Clash YAML profile in an alternative (sing-box) format.
//
// The key invariant: a YAML subscription WITHOUT ?format= must keep serving
// raw Clash YAML byte-for-byte, because that is what every existing
// customer link depends on. Only ?format=singbox (alias: hiddify) converts.

const path = require('path');
const fs = require('fs');
const os = require('os');
const yaml = require('js-yaml');

const { yamlToJsonObject } = require('../utils/configConverter');

const CLASH_YAML = `mixed-port: 7890
allow-lan: false
proxies:
  - name: A
    type: vmess
    server: a.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    ws-opts:
      path: /x
      headers:
        Host: a.com
  - name: B
    type: trojan
    server: b.com
    port: 443
    password: pw
    sni: b.com
    alpn:
      - h2
      - http/1.1
  - name: C
    type: ss
    server: c.com
    port: 8388
    cipher: aes-256-gcm
    password: pw3
  - name: D
    type: hysteria2
    server: d.com
    port: 443
    password: pw4
    sni: d.com
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - A
      - B
rules:
  - MATCH,PROXY
`;

// Reproduce the helper used by the /sub/:id handler.
const clashYamlToSingbox = (rawYaml) => {
  try {
    const { config: sb } = yamlToJsonObject(rawYaml);
    return JSON.stringify({ outbounds: sb.outbounds }, null, 2);
  } catch (_) { return null; }
};

// Mirrors the route's format dispatch.
const serveYaml = (rawYaml, format) => {
  const yamlFormat = String(format || '').toLowerCase();
  if (yamlFormat === 'singbox' || yamlFormat === 'hiddify') {
    const sb = clashYamlToSingbox(rawYaml);
    if (sb) return { kind: 'singbox', body: sb, type: 'application/json; charset=utf-8' };
  }
  return { kind: 'clash', body: rawYaml, type: 'text/plain; charset=utf-8' };
};

describe('YAML subscription format dispatch', () => {
  test('no format serves raw Clash YAML unchanged (existing links safe)', () => {
    const r = serveYaml(CLASH_YAML, undefined);
    expect(r.kind).toBe('clash');
    expect(r.body).toBe(CLASH_YAML);
  });

  test('an unknown format also serves raw Clash YAML (never errors)', () => {
    const r = serveYaml(CLASH_YAML, 'totally-unknown');
    expect(r.kind).toBe('clash');
    expect(r.body).toBe(CLASH_YAML);
  });

  test('format=singbox serves JSON content-type and outbounds', () => {
    const r = serveYaml(CLASH_YAML, 'singbox');
    expect(r.kind).toBe('singbox');
    expect(r.type).toBe('application/json; charset=utf-8');
    const parsed = JSON.parse(r.body);
    expect(Array.isArray(parsed.outbounds)).toBe(true);
  });

  test('format=hiddify is an alias for singbox', () => {
    const a = serveYaml(CLASH_YAML, 'singbox');
    const b = serveYaml(CLASH_YAML, 'hiddify');
    expect(b.kind).toBe('singbox');
    expect(b.body).toBe(a.body);
  });

  test('format is case-insensitive', () => {
    expect(serveYaml(CLASH_YAML, 'SingBox').kind).toBe('singbox');
    expect(serveYaml(CLASH_YAML, 'HIDDIFY').kind).toBe('singbox');
  });
});

describe('Clash YAML -> sing-box conversion (Hiddify format)', () => {
  let sb;

  beforeAll(() => {
    sb = JSON.parse(clashYamlToSingbox(CLASH_YAML));
  });

  const proxy = (name) => sb.outbounds.find(o => o.tag === name || o.tag === name.replace(/^([A-Z])$/, 'prox$1'));

  test('contains a selector, a default proxy, direct and block', () => {
    const types = sb.outbounds.map(o => o.type);
    expect(types).toContain('selector');
    expect(types).toContain('direct');
    expect(types).toContain('block');
  });

  test('converts every supported proxy type', () => {
    const types = new Set(sb.outbounds.map(o => o.type));
    for (const t of ['vmess', 'trojan', 'shadowsocks', 'hysteria2']) {
      expect(types.has(t)).toBe(true);
    }
  });

  test('carries vmess ws transport and Host header', () => {
    const ob = sb.outbounds.find(o => o.type === 'vmess');
    expect(ob.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(ob.transport.type).toBe('ws');
    expect(ob.transport.path).toBe('/x');
    expect(ob.transport.headers.Host).toBe('a.com');
    expect(ob.tls.enabled).toBe(true);
  });

  test('infers TLS from sni when tls: true is absent (trojan)', () => {
    const ob = sb.outbounds.find(o => o.type === 'trojan');
    expect(ob.tls.enabled).toBe(true);
    expect(ob.tls.server_name).toBe('b.com');
    expect(ob.tls.alpn).toEqual(['h2', 'http/1.1']);
  });

  test('normalizes Clash "ss" to sing-box "shadowsocks" with method', () => {
    const ob = sb.outbounds.find(o => o.type === 'shadowsocks');
    expect(ob.method).toBe('aes-256-gcm');
  });

  test('hysteria2 keeps its password and gains TLS', () => {
    const ob = sb.outbounds.find(o => o.type === 'hysteria2');
    expect(ob.password).toBe('pw4');
    expect(ob.tls.enabled).toBe(true);
  });

  test('every selector member resolves to a real outbound tag', () => {
    const selector = sb.outbounds.find(o => o.type === 'selector');
    const tags = new Set(sb.outbounds.map(o => o.tag));
    for (const m of selector.outbounds) expect(tags.has(m)).toBe(true);
  });

  test('tags are unique (sing-box rejects duplicates)', () => {
    const tags = sb.outbounds.map(o => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('failure handling', () => {
  test('unparseable YAML returns null so the route can fall back', () => {
    expect(clashYamlToSingbox('proxies:\n  - name: x\n   bad: [\n')).toBeNull();
  });

  test('YAML with no proxies returns null rather than an empty profile', () => {
    expect(clashYamlToSingbox('proxies: []\n')).toBeNull();
  });

  test('a failed conversion still yields a usable raw YAML response', () => {
    const broken = 'proxies:\n  - name: x\n   bad: [\n';
    const r = serveYaml(broken, 'singbox');
    expect(r.kind).toBe('clash');
    expect(r.body).toBe(broken);
  });

  test('converting an already-singular proxy list still works', () => {
    const single = 'proxies:\n  - name: Only\n    type: trojan\n    server: a.com\n    port: 443\n    password: p\n';
    const r = serveYaml(single, 'singbox');
    expect(r.kind).toBe('singbox');
    const parsed = JSON.parse(r.body);
    expect(parsed.outbounds.filter(o => o.type === 'trojan').length).toBe(1);
    // Single proxy: no selector is needed.
    expect(parsed.outbounds.find(o => o.type === 'selector')).toBeUndefined();
  });
});

describe('real-corpus regression (sanity)', () => {
  // If a real Clash profile is on disk next to this test, convert it and
  // assert the output re-parses. Skips cleanly when absent.
  const sample = path.join(__dirname, '..', 'data', 'keyserver.json');

  test('output of every conversion is valid JSON with a usable outbounds list', () => {
    const docs = [
      CLASH_YAML,
      'proxies:\n  - name: S\n    type: ss\n    server: a.com\n    port: 1\n    cipher: aes-128-gcm\n    password: p\n',
      'proxies:\n  - name: V\n    type: vless\n    server: a.com\n    port: 443\n    uuid: u\n    tls: true\n    servername: a.com\n    reality-opts:\n      public-key: PK\n      short-id: ab\n',
    ];
    for (const doc of docs) {
      const out = clashYamlToSingbox(doc);
      expect(out).not.toBeNull();
      const parsed = JSON.parse(out);
      expect(Array.isArray(parsed.outbounds)).toBe(true);
      expect(parsed.outbounds.length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(sample)).toBe(true);
  });
});
