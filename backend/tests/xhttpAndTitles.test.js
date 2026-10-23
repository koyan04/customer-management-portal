// Tests for two behaviours that were wrong in the first implementation:
//
//  1. xhttp. The first version mapped xhttp onto the plain `http` transport,
//     reasoning that sing-box has no xhttp support. For THIS system that was
//     the wrong conclusion: the portal's own JSON generator already emits
//     `transport: { type:'xhttp', ... }` and the saved .json profiles work.
//     The converter now reproduces that shape exactly.
//
//  2. Proxy naming. The first version renamed the first outbound to "proxy",
//     which erased the display name of the leading node (SG01, HK01, ...).
//
// clashToSingbox(clash, warnings) returns the sing-box config directly.
// jsonToYamlObject(text) returns { config, warnings }.

const { clashToSingbox, jsonToYamlObject } = require('../utils/configConverter');

// Mirrors the real production xhttp-opts shape seen in the config corpus.
const xhttpProxy = (overrides = {}) => ({
  name: 'SG-XHTTP',
  type: 'vless',
  server: 'x1.vchannel.dpdns.org',
  port: 443,
  uuid: '11111111-2222-3333-4444-555555555555',
  network: 'xhttp',
  tls: true,
  servername: 'x1.vchannel.dpdns.org',
  'xhttp-opts': { host: 'x1.vchannel.dpdns.org', mode: 'auto', path: '/xtp01/' },
  ...overrides,
});

describe('xhttp transport', () => {
  // The contract: a YAML profile converted to JSON must produce the SAME xhttp
  // transport shape as the portal's JSON generator, because those .json files
  // are what customers already use successfully. See
  // frontend/src/pages/JsonGeneratorPage.jsx convertNodeToSingbox:
  //   transport: { type:'xhttp', host, path, mode, extra? }
  test('keeps the xhttp transport type and matches the JSON generator shape', () => {
    const config = clashToSingbox({ proxies: [xhttpProxy()] }, []);

    const ob = config.outbounds.find(o => o.type === 'vless');
    expect(ob).toBeDefined();
    expect(ob.tag).toBe('SG-XHTTP');
    expect(ob.transport).toEqual({
      type: 'xhttp',
      host: 'x1.vchannel.dpdns.org',
      path: '/xtp01/',
      mode: 'auto',
    });
  });

  test('defaults host to the server and path to "/" when xhttp-opts is sparse', () => {
    const config = clashToSingbox(
      { proxies: [xhttpProxy({ 'xhttp-opts': { mode: 'auto' } })] }, []
    );
    const ob = config.outbounds.find(o => o.type === 'vless');
    expect(ob.transport.type).toBe('xhttp');
    expect(ob.transport.path).toBe('/');
    expect(ob.transport.host).toBe('x1.vchannel.dpdns.org'); // fell back to server
    expect(ob.transport.mode).toBe('auto');
  });

  test('translates the advanced Clash knobs into the JSON `extra` object', () => {
    // One production node uses these; they must not be silently dropped.
    const config = clashToSingbox({
      proxies: [xhttpProxy({
        'xhttp-opts': {
          host: 'x2.vchannel.dpdns.org', mode: 'auto', path: '/xtp02/',
          'max-body-size': 30,
          'padding-bytes': '100-1000',
          'user-agent': 'Mozilla/5.0',
          'user-agent-headers': { Accept: 'text/html' },
          uplink: [{ type: 'http' }, { type: 'tls' }],
        },
      })],
    }, []);
    const t = config.outbounds.find(o => o.type === 'vless').transport;
    expect(t.type).toBe('xhttp');
    expect(t.extra).toEqual({
      maxBodySize: 30,
      xPaddingBytes: '100-1000',
      userAgent: 'Mozilla/5.0',
      userAgentHeaders: { Accept: 'text/html' },
      uplink: [{ type: 'http' }, { type: 'tls' }],
    });
  });

  test('omits `extra` entirely when no advanced options are set', () => {
    const config = clashToSingbox({ proxies: [xhttpProxy()] }, []);
    const t = config.outbounds.find(o => o.type === 'vless').transport;
    expect('extra' in t).toBe(false);
  });

  test('xhttp is distinct from a real http-network proxy', () => {
    const config = clashToSingbox({
      proxies: [
        { name: 'A', type: 'trojan', server: 'a.com', port: 443, password: 'p', network: 'http',
          'http-opts': { path: ['/v1'], headers: { Host: ['a.com'] } } },
        xhttpProxy({ name: 'B', server: 'b.com', servername: 'b.com',
          'xhttp-opts': { host: 'b.com', mode: 'auto', path: '/xtp01/' } }),
      ],
    }, []);
    const a = config.outbounds.find(o => o.tag === 'A');
    const b = config.outbounds.find(o => o.tag === 'B');
    // A stays plain http (Clash http-opts.path is a list, passed through).
    expect(a.transport.type).toBe('http');
    expect(a.transport.path).toEqual(['/v1']);
    // B stays xhttp and is NOT collapsed into http.
    expect(b.transport.type).toBe('xhttp');
    expect(b.transport.path).toBe('/xtp01/');
  });

  test('round-trips back to Clash xhttp-opts with the advanced knobs flattened', () => {
    const config = clashToSingbox({
      proxies: [xhttpProxy({
        'xhttp-opts': {
          host: 'x2.vchannel.dpdns.org', mode: 'auto', path: '/xtp02/',
          'max-body-size': 30, 'padding-bytes': '100-1000',
        },
      })],
    }, []);
    const back = jsonToYamlObject(JSON.stringify(config)).config;
    const p = back.proxies[0];
    expect(p.network).toBe('xhttp');
    expect(p['xhttp-opts']).toEqual({
      host: 'x2.vchannel.dpdns.org',
      path: '/xtp02/',
      mode: 'auto',
      'max-body-size': 30,
      'padding-bytes': '100-1000',
    });
  });

  test('an xhttp node inside a group still resolves as a member', () => {
    const config = clashToSingbox({
      proxies: [xhttpProxy(), { name: 'SG-WS', type: 'trojan', server: 'b.com', port: 443, password: 'p', sni: 'b.com' }],
      'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['SG-XHTTP', 'SG-WS'] }],
    }, []);
    const grp = config.outbounds.find(o => o.tag === 'PROXY');
    expect(grp).toBeDefined();
    expect(grp.outbounds).toEqual(expect.arrayContaining(['SG-XHTTP', 'SG-WS']));
  });
});

describe('proxy name preservation', () => {
  test('the first proxy keeps its name instead of being retagged "proxy"', () => {
    const config = clashToSingbox({
      proxies: [
        { name: 'SG01', type: 'trojan', server: 'a.com', port: 443, password: 'p', sni: 'a.com' },
        { name: 'HK02', type: 'trojan', server: 'b.com', port: 443, password: 'p', sni: 'b.com' },
      ],
      'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: ['SG01', 'HK02'] }],
    }, []);

    expect(config.outbounds.some(o => o.tag === 'proxy')).toBe(false);
    expect(config.outbounds.some(o => o.tag === 'SG01')).toBe(true);

    // The manual selector defaults to the first node and lists real names.
    const sel = config.outbounds.find(o => o.tag === 'select');
    expect(sel.default).toBe('SG01');
    expect(sel.outbounds).toEqual(expect.arrayContaining(['SG01', 'HK02']));

    // Groups still resolve — no dangling members after the rename removal.
    const grp = config.outbounds.find(o => o.tag === 'PROXY');
    expect(grp.outbounds).toEqual(expect.arrayContaining(['SG01', 'HK02']));
  });
});

describe('profile title derivation', () => {
  const { profileTitleFor, planFromComment, customerFromFilename } = require('../utils/configConverter');

  // The four plan comments actually present in the production corpus.
  test('reads the plan from each real leading-comment variant', () => {
    expect(planFromComment('# VChannel-Premium\nport: 7890')).toBe('VChannel Premium');
    expect(planFromComment('# VChannel-Premium v3\nport: 7890')).toBe('VChannel Premium');
    expect(planFromComment('# VChannel-Premium (Unlimited)\nport: 7890')).toBe('VChannel Premium');
    expect(planFromComment('# VChannel-Premium (Unlimited) v3\nport: 7890')).toBe('VChannel Premium');
  });

  test('combines plan and customer into the expected title', () => {
    expect(profileTitleFor('vchannel-config-kyawhtet.yaml', '# VChannel-Premium\nport: 7890'))
      .toBe('VChannel Premium - Kyaw Htet');
  });

  test('title-cases multi-word and hyphenated handles', () => {
    // Hyphenated handles split on the hyphen; each chunk is then split into
    // words only when every resulting part is a known name component.
    expect(customerFromFilename('vchannel-config-hninei-laptop.yaml')).toBe('Hninei Laptop');
    expect(customerFromFilename('vchannel-config-yanlinhtet-pc.yaml')).toBe('Yan Lin Htet Pc');
    expect(customerFromFilename('vchannel-config-aanwe.yaml')).toBe('Aanwe');
  });

  test('splits a run-together handle into its name parts', () => {
    // The case that motivated the splitter.
    expect(customerFromFilename('vchannel-config-kyawhtet.yaml')).toBe('Kyaw Htet');
    expect(customerFromFilename('vchannel-config-aungmin.yaml')).toBe('Aung Min');
    expect(customerFromFilename('vchannel-config-kyawzinlin02.yaml')).toBe('Kyaw Zin Lin 02');
  });

  test('does NOT invent a split that is not supported', () => {
    // A handle that does not decompose into known parts is left whole rather
    // than guessed at. "Aanwe" must not become "Aan We".
    expect(customerFromFilename('vchannel-config-aanwe.yaml')).toBe('Aanwe');
    expect(customerFromFilename('vchannel-config-vesper.yaml')).toBe('Vesper');
    expect(customerFromFilename('vchannel-config-eimyatyadanar.yaml')).toBe('Eimyatyadanar');
  });

  test('does not split a name that is itself a single known name', () => {
    // "sandar" is one word; splitting it into "San Dar" would be wrong.
    expect(customerFromFilename('vchannel-config-sandar.yaml')).toBe('Sandar');
  });

  test('keeps a trailing account number as its own token', () => {
    expect(customerFromFilename('vchannel-config-waipaung02.yaml')).toBe('Waipaung 02');
    expect(customerFromFilename('vchannel-config-nge04s.yaml')).toBe('Nge 04s');
  });

  test('falls back to the default plan when there is no comment', () => {
    expect(profileTitleFor('vchannel-config-akhein.yaml', 'port: 7890\n'))
      .toBe('VChannel Premium - Akhein');
  });

  test('returns just the plan when the filename has no usable name', () => {
    // A bare token filename must not leak a 32-hex string into the UI.
    expect(profileTitleFor('vchannel-config-693d8cad2925c2e5cba4a82e4922cf29.yaml', '# VChannel-Premium'))
      .toBe('VChannel Premium');
    expect(profileTitleFor('vchannel-config-.yaml', '# VChannel-Premium'))
      .toBe('VChannel Premium');
  });

  test('handles json and txt configs too', () => {
    expect(customerFromFilename('vchannel-config-aanwe.json')).toBe('Aanwe');
    expect(customerFromFilename('vchannel-config-aanwe.txt')).toBe('Aanwe');
  });

  test('is not confused by CRLF line endings', () => {
    expect(profileTitleFor('vchannel-config-akhein.yaml', '# VChannel-Premium\r\nport: 7890\r\n'))
      .toBe('VChannel Premium - Akhein');
  });

  test('a non-plan leading comment is used but normalised like any plan', () => {
    // Documented behaviour: whatever the first comment says becomes the plan,
    // with punctuation separated into words.
    expect(profileTitleFor('vchannel-config-x.yaml', '# Expire Date: 2027-01-30\n'))
      .toBe('Expire Date 2027 01 30 - X');
  });

  test('a config with no comment at all still gets the default plan', () => {
    expect(profileTitleFor('vchannel-config-akhein.yaml', ''))
      .toBe('VChannel Premium - Akhein');
    expect(profileTitleFor('vchannel-config-akhein.yaml', 'port: 7890\n'))
      .toBe('VChannel Premium - Akhein');
  });
});
