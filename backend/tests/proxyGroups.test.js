// Tests for Clash proxy-groups -> sing-box selector / urltest conversion.
//
// sing-box has ONLY `selector` and `urltest` group types. Clash has four
// (select, url-test, fallback, load-balance), so the mapping is partly an
// approximation. These tests pin down both the exact mappings and the
// documented approximations, and the structural invariants sing-box requires
// (unique tags, no dangling group members).

const yaml = require('js-yaml');
const { yamlToJsonObject, clashToSingbox, toSingboxDuration } = require('../utils/configConverter');

// Mirrors the actual production shape: every real config has a
// url-test "Auto Switch"/"Fastest" group, a fallback "Failover" group and a
// select group. Group names contain emoji, which is a real edge case for tags.
const REAL_SHAPED = `
mixed-port: 7890
proxies:
  - { name: SG-01, type: trojan, server: sg1.com, port: 443, password: p, sni: sg1.com }
  - { name: JP-02, type: trojan, server: jp2.com, port: 443, password: p, sni: jp2.com }
  - { name: US-03, type: vless, server: us3.com, port: 443, uuid: u3, tls: true, servername: us3.com }
proxy-groups:
  - name: "\u{1F680} Auto Switch"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 120
    tolerance: 50
    proxies: [SG-01, JP-02, US-03]
  - name: "\u{1F6D1} Failover"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 120
    proxies: [SG-01, JP-02, US-03]
  - name: PROXY
    type: select
    proxies: ["\u{1F680} Auto Switch", "\u{1F6D1} Failover", SG-01, JP-02, US-03, DIRECT]
`;

const build = (doc) => yamlToJsonObject(doc);

describe('group type mapping', () => {
  let sb;
  let warnings;

  beforeAll(() => {
    const r = build(REAL_SHAPED);
    sb = r.config;
    warnings = r.warnings;
  });

  test('url-test becomes a sing-box urltest with url/interval/tolerance', () => {
    const g = sb.outbounds.find(o => o.tag.includes('Auto Switch'));
    expect(g).toBeDefined();
    expect(g.type).toBe('urltest');
    expect(g.url).toBe('https://cp.cloudflare.com/generate_204');
    expect(g.tolerance).toBe(50);
  });

  test('fallback becomes a urltest AND emits a warning about the difference', () => {
    const g = sb.outbounds.find(o => o.tag.includes('Failover'));
    expect(g).toBeDefined();
    expect(g.type).toBe('urltest');
    expect(warnings.join(' ')).toMatch(/Failover/);
    expect(warnings.join(' ')).toMatch(/fastest/i);
  });

  test('select becomes a sing-box selector', () => {
    const g = sb.outbounds.find(o => o.type === 'selector' && o.tag === 'PROXY');
    expect(g).toBeDefined();
    expect(g.default).toBeTruthy();
  });

  test('load-balance becomes a urltest AND warns', () => {
    const r = build(`
proxies:
  - { name: A, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
  - { name: B, type: trojan, server: b.com, port: 443, password: p, sni: b.com }
proxy-groups:
  - name: LB
    type: load-balance
    proxies: [A, B]
`);
    const g = r.config.outbounds.find(o => o.type === 'urltest' && o.tag === 'LB');
    expect(g).toBeDefined();
    expect(r.warnings.join(' ')).toMatch(/load-balance/);
  });

  test('an unknown group type is skipped with a warning, not emitted raw', () => {
    const r = build(`
proxies:
  - { name: A, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
proxy-groups:
  - name: Weird
    type: relay
    proxies: [A]
`);
    expect(r.config.outbounds.some(o => o.tag === 'Weird')).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/relay/);
  });
});

describe('interval unit conversion', () => {
  test.each([
    [120, '2m'],
    [900, '15m'],
    [60, '1m'],
    [3600, '1h'],
    [30, '30s'],
    [240, '4m'],
  ])('converts %p seconds to %p', (input, expected) => {
    // A bare number means SECONDS in Clash but would fail to parse in sing-box.
    expect(toSingboxDuration(input)).toBe(expected);
  });

  test('passes through an already-formatted duration unchanged', () => {
    expect(toSingboxDuration('5m')).toBe('5m');
    expect(toSingboxDuration('30s')).toBe('30s');
  });

  test('ignores missing or invalid values', () => {
    expect(toSingboxDuration(undefined)).toBeUndefined();
    expect(toSingboxDuration(null)).toBeUndefined();
    expect(toSingboxDuration('')).toBeUndefined();
    expect(toSingboxDuration('not-a-number')).toBeUndefined();
    expect(toSingboxDuration(0)).toBeUndefined();
  });

  test('every emitted urltest interval is a valid Go duration', () => {
    const { config } = build(REAL_SHAPED);
    for (const o of config.outbounds.filter(x => x.type === 'urltest')) {
      expect(o.interval).toMatch(/^\d+(ms|s|m|h)$/);
    }
  });
});

describe('structural invariants sing-box requires', () => {
  let sb;

  beforeAll(() => { sb = build(REAL_SHAPED).config; });

  test('all tags are unique', () => {
    const tags = sb.outbounds.map(o => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  test('no selector or urltest references a missing tag', () => {
    const tags = new Set(sb.outbounds.map(o => o.tag));
    for (const o of sb.outbounds.filter(x => x.type === 'selector' || x.type === 'urltest')) {
      for (const m of o.outbounds) {
        expect(tags.has(m)).toBe(true);
      }
    }
  });

  test('direct and block are present and last', () => {
    const types = sb.outbounds.map(o => o.type);
    expect(types).toContain('direct');
    expect(types).toContain('block');
  });

  test('emoji group names survive as valid tags', () => {
    expect(sb.outbounds.some(o => o.tag.includes('\u{1F680}'))).toBe(true);
    expect(sb.outbounds.some(o => o.tag.includes('\u{1F6D1}'))).toBe(true);
  });

  test('a group may reference another group (nesting is allowed)', () => {
    const sel = sb.outbounds.find(o => o.tag === 'PROXY');
    const autoTag = sb.outbounds.find(o => o.tag.includes('Auto Switch')).tag;
    const failTag = sb.outbounds.find(o => o.tag.includes('Failover')).tag;
    expect(sel.outbounds).toContain(autoTag);
    expect(sel.outbounds).toContain(failTag);
  });
});

describe('defensive member handling', () => {
  test('built-in DIRECT is dropped, not emitted as a dangling tag', () => {
    const { config } = build(REAL_SHAPED);
    const sel = config.outbounds.find(o => o.tag === 'PROXY');
    expect(sel.outbounds).not.toContain('DIRECT');
    const tags = new Set(config.outbounds.map(o => o.tag));
    for (const m of sel.outbounds) expect(tags.has(m)).toBe(true);
  });

  test('a group referencing only unknown names is skipped entirely', () => {
    const r = build(`
proxies:
  - { name: A, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
proxy-groups:
  - name: Ghost
    type: select
    proxies: [DoesNotExist, AlsoMissing]
`);
    expect(r.config.outbounds.some(o => o.tag === 'Ghost')).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/Ghost/);
  });

  test('a group name colliding with a proxy tag is disambiguated', () => {
    const r = build(`
proxies:
  - { name: Clash, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
proxy-groups:
  - name: Clash
    type: select
    proxies: [Clash]
`);
    const tags = r.config.outbounds.map(o => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  test('duplicate group names do not collide', () => {
    const r = build(`
proxies:
  - { name: A, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
proxy-groups:
  - { name: Same, type: select, proxies: [A] }
  - { name: Same, type: url-test, proxies: [A] }
`);
    const tags = r.config.outbounds.map(o => o.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.filter(t => t.startsWith('Same'))).toHaveLength(2);
  });
});

describe('no-groups and edge cases', () => {
  test('a config with no proxy-groups still gets the manual selector', () => {
    const { config } = build(`
proxies:
  - { name: A, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
  - { name: B, type: trojan, server: b.com, port: 443, password: p, sni: b.com }
`);
    const sel = config.outbounds.find(o => o.type === 'selector' && o.tag === 'select');
    expect(sel).toBeDefined();
    expect(config.outbounds.some(o => o.type === 'urltest')).toBe(false);
  });

  test('a single-proxy config produces no group outbounds', () => {
    const { config } = build(`
proxies:
  - { name: Only, type: trojan, server: a.com, port: 443, password: p, sni: a.com }
proxy-groups:
  - { name: G, type: select, proxies: [Only] }
`);
    const g = config.outbounds.find(o => o.tag === 'G');
    expect(g).toBeDefined();
    // The proxy keeps its original Clash name.
    expect(g.outbounds).toEqual(['Only']);
  });

  test('rules still produce a warning (routing is not converted)', () => {
    const { warnings } = build(`${REAL_SHAPED}\nrules:\n  - MATCH,PROXY\n`);
    expect(warnings.join(' ')).toMatch(/rule/);
  });
});
