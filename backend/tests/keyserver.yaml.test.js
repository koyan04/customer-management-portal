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
});

