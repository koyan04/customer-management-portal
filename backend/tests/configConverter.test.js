const {
  yamlToJsonObject,
  jsonToYamlObject,
  stringifySingbox,
  stringifyClash,
  clashToSingbox,
  singboxToClash,
} = require('../utils/configConverter');
const yaml = require('js-yaml');

// Minimal but representative Clash config covering every protocol the key
// server can serve, plus ws/grpc/xhttp transports and Reality.
const CLASH_YAML = `
mixed-port: 7890
allow-lan: false
mode: rule
proxies:
  - name: SG-WS
    type: vmess
    server: sg01.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    alterId: 0
    cipher: auto
    tls: true
    servername: sg01.example.com
    skip-cert-verify: false
    network: ws
    ws-opts:
      path: /ray
      headers:
        Host: sg01.example.com
  - name: JP-Reality
    type: vless
    server: jp02.example.com
    port: 443
    uuid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
    network: tcp
    tls: true
    servername: www.microsoft.com
    client-fingerprint: chrome
    flow: xtls-rprx-vision
    reality-opts:
      public-key: PUBLICKEYVALUE
      short-id: ab12
  - name: DE-Trojan
    type: trojan
    server: de03.example.com
    port: 443
    password: trojanPass
    sni: de03.example.com
    skip-cert-verify: true
    alpn:
      - h2
      - http/1.1
  - name: US-SS
    type: ss
    server: us04.example.com
    port: 8388
    cipher: aes-256-gcm
    password: ssPass
  - name: KR-Hy2
    type: hysteria2
    server: kr05.example.com
    port: 443
    password: hy2Pass
    sni: kr05.example.com
    upmbps: 50
    downmbps: 200
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - SG-WS
      - JP-Reality
rules:
  - MATCH,PROXY
`;

describe('clashToSingbox', () => {
  let out;
  let warnings;

  beforeAll(() => {
    const res = yamlToJsonObject(CLASH_YAML);
    out = res.config;
    warnings = res.warnings;
  });

  test('preserves the first proxy name as the default proxy tag', () => {
    expect(Array.isArray(out.outbounds)).toBe(true);
    // The selector is prepended, so index 0 is the group; the default proxy
    // is the first non-selector outbound. Its ORIGINAL Clash name is kept so
    // the node keeps a human-readable label in the client.
    const def = out.outbounds.find(o => o.type === 'vmess');
    expect(def.tag).toBe('SG-WS');
  });

  test('adds a selector group when there is more than one proxy', () => {
    const selector = out.outbounds.find(o => o.type === 'selector');
    expect(selector).toBeDefined();
    expect(selector.tag).toBe('select');
    expect(selector.outbounds).toContain('SG-WS');
    expect(selector.default).toBe('SG-WS');
  });

  test('always terminates with direct + block outbounds', () => {
    const tags = out.outbounds.map(o => o.tag);
    expect(tags).toContain('direct');
    expect(tags).toContain('block');
  });

  test('maps vmess credentials and ws transport', () => {
    const ob = out.outbounds.find(o => o.type === 'vmess');
    expect(ob.type).toBe('vmess');
    expect(ob.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(ob.alter_id).toBe(0);
    expect(ob.security).toBe('auto');
    expect(ob.transport.type).toBe('ws');
    expect(ob.transport.path).toBe('/ray');
    expect(ob.transport.headers.Host).toBe('sg01.example.com');
    expect(ob.tls.enabled).toBe(true);
    expect(ob.tls.server_name).toBe('sg01.example.com');
  });

  test('maps vless reality + uTLS fingerprint + flow', () => {
    const ob = out.outbounds.find(o => o.tag === 'JP-Reality');
    expect(ob.type).toBe('vless');
    expect(ob.flow).toBe('xtls-rprx-vision');
    expect(ob.tls.reality.enabled).toBe(true);
    expect(ob.tls.reality.public_key).toBe('PUBLICKEYVALUE');
    expect(ob.tls.reality.short_id).toBe('ab12');
    expect(ob.tls.utls.fingerprint).toBe('chrome');
    // tcp is the default transport and must not add a transport block
    expect(ob.transport).toBeUndefined();
  });

  test('converts a block-style alpn list to an array', () => {
    const ob = out.outbounds.find(o => o.tag === 'DE-Trojan');
    expect(ob.tls.alpn).toEqual(['h2', 'http/1.1']);
    expect(ob.tls.insecure).toBe(true);
  });

  test('every selector member resolves to a real outbound tag', () => {
    const selector = out.outbounds.find(o => o.type === 'selector');
    const tags = new Set(out.outbounds.map(o => o.tag));
    for (const member of selector.outbounds) {
      expect(tags.has(member)).toBe(true);
    }
  });

  test('infers TLS from sni/alpn even when "tls: true" is absent', () => {
    // DE-Trojan sets sni + alpn but no explicit `tls:` key.
    const ob = out.outbounds.find(o => o.tag === 'DE-Trojan');
    expect(ob.tls.enabled).toBe(true);
    expect(ob.tls.server_name).toBe('de03.example.com');
    expect(ob.tls.alpn).toEqual(['h2', 'http/1.1']);
  });

  test('hysteria2 always gets TLS (required by sing-box)', () => {
    const ob = out.outbounds.find(o => o.tag === 'KR-Hy2');
    expect(ob.tls.enabled).toBe(true);
    expect(ob.tls.server_name).toBe('kr05.example.com');
  });

  test('honours an explicit "tls: false"', () => {
    const res = yamlToJsonObject(`
proxies:
  - name: Plain
    type: trojan
    server: a.com
    port: 443
    password: p
    tls: false
`);
    expect(res.config.outbounds.find(o => o.type === 'trojan').tls).toBeUndefined();
  });

  test('leaves TLS off for a node with no TLS indicators at all', () => {
    const res = yamlToJsonObject(`
proxies:
  - name: Plain
    type: vmess
    server: a.com
    port: 80
    uuid: u
`);
    expect(res.config.outbounds.find(o => o.type === 'vmess').tls).toBeUndefined();
  });

  test('renames shadowsocks cipher to method and normalizes the type', () => {
    const ob = out.outbounds.find(o => o.tag === 'US-SS');
    expect(ob.type).toBe('shadowsocks');
    expect(ob.method).toBe('aes-256-gcm');
    expect(ob.cipher).toBeUndefined();
  });

  test('accepts the Clash canonical "ss" type (what this project emits)', () => {
    const ob = out.outbounds.find(o => o.tag === 'US-SS');
    expect(ob).toBeDefined();
  });

  test('maps hysteria2 bandwidth and password', () => {
    const ob = out.outbounds.find(o => o.tag === 'KR-Hy2');
    expect(ob.type).toBe('hysteria2');
    expect(ob.password).toBe('hy2Pass');
    expect(ob.up_mbps).toBe(50);
    expect(ob.down_mbps).toBe(200);
  });

  test('preserves proxy-groups and warns only about rules', () => {
    // Named groups are now converted to sing-box selector/urltest outbounds
    // (see tests/proxyGroups.test.js), so no group warning is expected here.
    const tags = out.outbounds.map(o => o.tag);
    expect(tags).toContain('PROXY');
    // Only the routing-rule conversion is still unsupported.
    expect(warnings.join(' ')).toMatch(/rule/);
  });

  test('omits unsupported proxy types and says so', () => {
    const res = yamlToJsonObject(`
proxies:
  - name: MyDNS
    type: dns
    server: 1.1.1.1
    port: 53
  - name: Real
    type: trojan
    server: a.com
    port: 443
    password: p
`);
    expect(res.config.outbounds.some(o => o.tag === 'MyDNS')).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/MyDNS/);
    // "Real" is the first convertible proxy, so it is the default route. Its
    // original name must be preserved.
    const kept = res.config.outbounds.filter(o => o.type === 'trojan');
    expect(kept.length).toBe(1);
    expect(kept[0].tag).toBe('Real');
  });

  test('rejects a config with no convertible proxies', () => {
    expect(() => yamlToJsonObject('proxies: []\n')).toThrow(/No convertible proxies/);
  });

  test('rejects malformed YAML with a clear message', () => {
    expect(() => yamlToJsonObject('proxies:\n  - name: x\n   bad indent: [\n')).toThrow(/Invalid YAML/);
  });

  test('rejects an empty YAML document', () => {
    expect(() => yamlToJsonObject('# just a comment\n')).toThrow(/empty/);
  });

  test('skips proxies missing server or port', () => {
    const res = yamlToJsonObject(`
proxies:
  - name: Broken
    type: trojan
    password: p
  - name: Fine
    type: trojan
    server: a.com
    port: 443
    password: p
`);
    expect(res.config.outbounds.some(o => o.tag === 'Broken')).toBe(false);
    expect(res.warnings.join(' ')).toMatch(/server or port/);
  });
});

describe('singboxToClash', () => {
  const SINGBOX_JSON = JSON.stringify({
    log: { level: 'info' },
    outbounds: [
      { type: 'selector', tag: 'select', outbounds: ['proxy', 'second'] },
      {
        type: 'vmess', tag: 'proxy', server: 'a.com', server_port: 443,
        uuid: '11111111-2222-3333-4444-555555555555', alter_id: 0, security: 'auto',
        tls: { enabled: true, server_name: 'a.com', alpn: ['h2', 'http/1.1'] },
        transport: { type: 'ws', path: '/ray', headers: { Host: 'a.com' } },
      },
      {
        type: 'vless', tag: 'second', server: 'b.com', server_port: 443,
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tls: { enabled: true, server_name: 'www.microsoft.com', reality: { enabled: true, public_key: 'PK', short_id: 'ab12' }, utls: { fingerprint: 'chrome' } },
      },
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
  });

  let clash;

  beforeAll(() => {
    clash = jsonToYamlObject(SINGBOX_JSON).config;
  });

  test('produces a Clash config with proxies and a proxy group', () => {
    expect(Array.isArray(clash.proxies)).toBe(true);
    expect(clash.proxies.length).toBe(2);
    expect(clash['proxy-groups'].length).toBeGreaterThan(0);
  });

  test('drops non-proxy outbounds (direct/block/selector)', () => {
    const names = clash.proxies.map(p => p.name);
    // A proxy literally named "proxy" is a legal name and is preserved as-is.
    expect(names).toEqual(['proxy', 'second']);
  });

  test('maps vmess fields back to Clash naming', () => {
    const p = clash.proxies[0];
    expect(p.type).toBe('vmess');
    expect(p.port).toBe(443);
    expect(p.alterId).toBe(0);
    expect(p.cipher).toBe('auto');
    expect(p.network).toBe('ws');
    expect(p['ws-opts'].path).toBe('/ray');
    expect(p['ws-opts'].headers.Host).toBe('a.com');
    expect(p.tls).toBe(true);
    expect(p.servername).toBe('a.com');
  });

  test('maps reality back into reality-opts', () => {
    const p = clash.proxies[1];
    expect(p['reality-opts']['public-key']).toBe('PK');
    expect(p['reality-opts']['short-id']).toBe('ab12');
    expect(p['client-fingerprint']).toBe('chrome');
  });

  test('group name never collides with a proxy name', () => {
    const groupName = clash['proxy-groups'][0].name;
    expect(clash.proxies.map(p => p.name)).not.toContain(groupName);
  });

  test('rejects a JSON root without outbounds', () => {
    expect(() => jsonToYamlObject('{"hello":"world"}')).toThrow(/outbounds/);
  });

  test('rejects invalid JSON', () => {
    expect(() => jsonToYamlObject('{not json')).toThrow(/Invalid JSON/);
  });

  test('rejects a JSON array root', () => {
    expect(() => jsonToYamlObject('[]')).toThrow(/must be an object/);
  });

  test('rejects a config with no proxy outbounds', () => {
    expect(() => jsonToYamlObject('{"outbounds":[{"type":"direct","tag":"d"}]}')).toThrow(/No convertible proxy/);
  });
});

describe('duplicate proxy names', () => {
  test('disambiguates repeated sing-box tags so Clash stays valid', () => {
    const clash = jsonToYamlObject(JSON.stringify({
      outbounds: [
        { type: 'trojan', tag: 'dup', server: 'a.com', server_port: 443, password: 'p' },
        { type: 'trojan', tag: 'dup', server: 'b.com', server_port: 443, password: 'p' },
      ],
    })).config;

    const names = clash.proxies.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('stringifyClash', () => {
  test('emits proxy-level alpn INLINE (block sequences break Clash)', () => {
    const clash = {
      proxies: [{ name: 'n', type: 'trojan', server: 'a.com', port: 443, password: 'p', tls: true, alpn: ['h2', 'http/1.1'] }],
    };
    const text = stringifyClash(clash);

    expect(text).toMatch(/^ {4}alpn: \[h2, http\/1\.1\]$/m);
    // No bare "alpn:" key may remain, and no 6-space dash items after it.
    expect(text).not.toMatch(/^ {4}alpn:\s*$/m);
    expect(text).not.toMatch(/^ {6}- /m);

    // And the result must still parse.
    const reparsed = yaml.load(text);
    expect(reparsed.proxies[0].alpn).toEqual(['h2', 'http/1.1']);
  });

  test('leaves a nested alpn (ws-opts) untouched', () => {
    const text = stringifyClash({
      proxies: [{
        name: 'n', type: 'vless', server: 'a.com', port: 443, uuid: 'u',
        'ws-opts': { headers: { alpn: ['h2'] } },
      }],
    });
    const reparsed = yaml.load(text);
    expect(reparsed.proxies[0]['ws-opts'].headers.alpn).toEqual(['h2']);
  });

  test('never wraps long values across lines', () => {
    const uuid = '11111111-2222-3333-4444-555555555555';
    const text = stringifyClash({
      proxies: [{ name: 'a-very-long-proxy-name-to-force-wrapping-attempt', type: 'vmess', server: 'a-very-long-hostname.example.com', port: 443, uuid }],
    });
    expect(text).toContain(uuid);
    expect(yaml.load(text).proxies[0].uuid).toBe(uuid);
  });
});

describe('stringifySingbox', () => {
  test('emits parseable JSON with a trailing newline and preserves key order', () => {
    const out = clashToSingbox(yaml.load(CLASH_YAML), []);
    const text = stringifySingbox(out);
    expect(text.endsWith('\n')).toBe(true);
    // log must precede outbounds (natural order, not alphabetical)
    expect(text.indexOf('"log"')).toBeLessThan(text.indexOf('"outbounds"'));
    expect(JSON.parse(text).outbounds.length).toBe(out.outbounds.length);
  });
});

describe('round trip', () => {
  test('YAML -> JSON -> YAML preserves every proxy core field', () => {
    const toJson = yamlToJsonObject(CLASH_YAML).config;
    const text = stringifySingbox(toJson);
    const back = jsonToYamlObject(text).config;

    expect(back.proxies.length).toBe(5);
    const byName = Object.fromEntries(back.proxies.map(p => [p.name, p]));

    // Proxy names survive the round trip unchanged (the first proxy keeps its
    // original name; nothing is retagged).
    const vmess = byName['SG-WS'];
    expect(vmess).toBeDefined();
    expect(vmess.type).toBe('vmess');
    expect(vmess.uuid).toBe('11111111-2222-3333-4444-555555555555');
    expect(vmess['ws-opts'].path).toBe('/ray');
    expect(vmess.servername).toBe('sg01.example.com');

    expect(byName['JP-Reality'].flow).toBe('xtls-rprx-vision');
    expect(byName['JP-Reality']['reality-opts']['public-key']).toBe('PUBLICKEYVALUE');

    expect(byName['DE-Trojan'].password).toBe('trojanPass');
    expect(byName['DE-Trojan'].alpn).toEqual(['h2', 'http/1.1']);

    expect(byName['US-SS'].cipher).toBe('aes-256-gcm');

    expect(byName['KR-Hy2'].password).toBe('hy2Pass');
    expect(byName['KR-Hy2'].downmbps).toBe(200);
  });

  test('the round-tripped YAML is itself valid YAML with unique names', () => {
    const toJson = yamlToJsonObject(CLASH_YAML).config;
    const yamlText = stringifyClash(singboxToClash(JSON.parse(stringifySingbox(toJson)), []));
    const parsed = yaml.load(yamlText);
    const names = parsed.proxies.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(() => validateShape(parsed)).not.toThrow();
  });
});

// Mirrors the proxy-depth rule enforced by clashYamlSanitizer.validateClashYaml:
// a dash item at 4-space indent inside the proxies block is always invalid.
function validateShape(config) {
  const text = stringifyClash(config);
  const lines = text.split('\n');
  const start = lines.findIndex(l => /^proxies:\s*$/.test(l));
  if (start === -1) throw new Error('missing proxies: key');
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[a-z-]+:/.test(lines[i])) break; // next top-level key
    if (/^ {4}- /.test(lines[i])) {
      throw new Error(`invalid proxy-depth list item: ${lines[i]}`);
    }
  }
}
