const { sanitizeClashYaml } = require('../utils/clashYamlSanitizer');
const yaml = require('js-yaml');

describe('Clash YAML Sanitization and Validation', () => {
  const brokenYaml = `# VChannel-Premium
# Expire Date: 2027-01-30
# profile-update-interval: 24

mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: true
external-controller: 127.0.0.1:9090

tun:
  enable: true
  stack: system
  mtu: 1400
  auto-route: true
  auto-detect-interface: true

proxies:

proxy-groups:
  - name: "🚀 VChannel-Premium"
    type: select
    proxies:
      - ♻️ Auto Switch (VChannel-Premium)
      - ⚡ Fastest (VChannel-Premium)
      - 🛡️ Failover (VChannel-Premium)
      - DIRECT

  - name: "♻️ Auto Switch (VChannel-Premium)"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 900
    tolerance: 4
    lazy: false
    proxies:

  - name: "⚡ Fastest (VChannel-Premium)"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 120
    tolerance: 50
    lazy: false
    proxies:

  - name: "🛡️ Failover (VChannel-Premium)"
    type: fallback
    url: https://cp.cloudflare.com/generate_204
    interval: 120
    lazy: false
    proxies:

rules:
  - DOMAIN-SUFFIX,netflix.com,🚀 VChannel-Premium
  - MATCH,🚀 VChannel-Premium
`;

  it('removes empty url-test and fallback groups and sets proxies to []', () => {
    const sanitized = sanitizeClashYaml(brokenYaml);

    expect(sanitized).toContain('proxies: []');
    expect(sanitized).not.toContain('♻️ Auto Switch (VChannel-Premium)');
    expect(sanitized).not.toContain('⚡ Fastest (VChannel-Premium)');
    expect(sanitized).not.toContain('🛡️ Failover (VChannel-Premium)');
    expect(sanitized).toContain('- DIRECT');
  });

  it('preserves valid proxy nodes and groups when nodes are present', () => {
    const validYaml = `# VChannel-Premium
proxies:
  - name: "SG01"
    type: vless
    server: 1.1.1.1
    port: 443

proxy-groups:
  - name: "🚀 VChannel-Premium"
    type: select
    proxies:
      - ♻️ Auto Switch (VChannel-Premium)
      - SG01

  - name: "♻️ Auto Switch (VChannel-Premium)"
    type: url-test
    url: https://cp.cloudflare.com/generate_204
    interval: 900
    proxies:
      - SG01

rules:
  - MATCH,🚀 VChannel-Premium
`;

    const sanitized = sanitizeClashYaml(validYaml);

    expect(sanitized).toContain('name: "SG01"');
    expect(sanitized).toContain('♻️ Auto Switch (VChannel-Premium)');
    expect(sanitized).not.toContain('proxies: []');
    expect(sanitized).toMatch(/^proxies:\s*$/m);

    // Verify sanitized YAML is 100% syntactically valid
    expect(() => yaml.load(sanitized)).not.toThrow();
    const parsed = yaml.load(sanitized);
    expect(Array.isArray(parsed.proxies)).toBe(true);
    expect(parsed.proxies.length).toBe(1);
  });

  it('heals corrupted proxies: [] if proxy nodes exist underneath', () => {
    const corruptedYaml = `# VChannel-Premium
proxies: []
  # comment
  - name: "SG01"
    type: vless
    server: 1.1.1.1
    port: 443

proxy-groups:
  - name: "🚀 VChannel-Premium"
    type: select
    proxies:
      - SG01
`;
    // Before sanitization, corrupted YAML throws syntax error in YAML parsers
    expect(() => yaml.load(corruptedYaml)).toThrow();

    const healed = sanitizeClashYaml(corruptedYaml);
    expect(healed).not.toContain('proxies: []');
    expect(healed).toMatch(/^proxies:\s*$/m);
    expect(() => yaml.load(healed)).not.toThrow();
    const parsed = yaml.load(healed);
    expect(parsed.proxies.length).toBe(1);
    expect(parsed.proxies[0].name).toBe('SG01');
  });

  it('strips enclosing quotes from rule targets so Clash/Mihomo can match proxy groups', () => {
    const yamlWithQuotedRules = `# VChannel-Premium
proxies:
  - name: "SG01"
    type: vless
    server: 1.1.1.1
    port: 443

proxy-groups:
  - name: "🚀 VChannel-Premium"
    type: select
    proxies:
      - SG01

rules:
  - DOMAIN-SUFFIX,netflix.com,"🚀 VChannel-Premium"
  - IP-CIDR,31.13.24.0/21,"🚀 VChannel-Premium",no-resolve
  - MATCH,"🚀 VChannel-Premium"
`;
    const sanitized = sanitizeClashYaml(yamlWithQuotedRules);
    expect(sanitized).toContain('- DOMAIN-SUFFIX,netflix.com,🚀 VChannel-Premium');
    expect(sanitized).toContain('- IP-CIDR,31.13.24.0/21,🚀 VChannel-Premium,no-resolve');
    expect(sanitized).toContain('- MATCH,🚀 VChannel-Premium');
    const rulesPart = sanitized.split('rules:')[1];
    expect(rulesPart).not.toContain('"🚀 VChannel-Premium"');
    expect(sanitized).toContain('name: "🚀 VChannel-Premium"');
  });

  it('heals Trojan node parameters (password decode, WS ALPN, skip-cert-verify)', () => {
    const yamlTrojan = `# VChannel-Premium
proxies:
  - name: "Trojan SG"
    type: trojan
    server: x1.vchannel.dpdns.org
    port: 80
    password: "DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn%25252BE%25253D"
    network: ws
    alpn: [h2, http/1.1]

proxy-groups:
  - name: "proxy"
    type: select
    proxies:
      - "Trojan SG"
`;
    const sanitized = sanitizeClashYaml(yamlTrojan);
    expect(sanitized).toContain('password: "DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn+E="');
    expect(sanitized).toContain('alpn: [http/1.1]');
    expect(sanitized).not.toContain('alpn: [h2, http/1.1]');
    expect(sanitized).toContain('skip-cert-verify: true');
  });

  it('heals VLESS REALITY node parameters (adds sni, quotes public-key & short-id)', () => {
    const yamlReality = `# VChannel-Premium
proxies:
  - name: "Reality SG"
    type: vless
    server: x1.vchannel.dpdns.org
    port: 8443
    uuid: 5ecbf80d-ebad-4426-8209-444456bb3e6a
    servername: www.goo.gl
    network: xhttp
    reality-opts:
      public-key: vkCXZH_bAtASkMY1ZlLYliPdNOdiIt7j6JPbk0yIDSM
      short-id: ee1731e8eda4dec8

proxy-groups:
  - name: "proxy"
    type: select
    proxies:
      - "Reality SG"
`;
    const sanitized = sanitizeClashYaml(yamlReality);
    expect(sanitized).toContain('sni: www.goo.gl');
    expect(sanitized).toContain('public-key: "vkCXZH_bAtASkMY1ZlLYliPdNOdiIt7j6JPbk0yIDSM"');
    expect(sanitized).toContain('short-id: "ee1731e8eda4dec8"');
  });
});

