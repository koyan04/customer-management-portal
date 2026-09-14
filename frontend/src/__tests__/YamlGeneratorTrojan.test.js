import { describe, it, expect, vi } from 'vitest';

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ token: null })
}));

import { normalizeTrojanNode } from '../pages/YamlGeneratorPage.jsx';

describe('normalizeTrojanNode', () => {
  it('keeps Clash-compatible WS/TLS fields aligned with the working config', () => {
    const node = normalizeTrojanNode({
      type: 'trojan',
      server: 'x1.vchannel.dpdns.org',
      port: 80,
      password: 'secret',
      network: 'ws',
      'ws-opts': {
        path: '/wsx1a1/',
        headers: { Host: 'x1.vchannel.dpdns.org' }
      }
    });

    expect(node).toMatchObject({
      type: 'trojan',
      tls: true,
      udp: true,
      network: 'ws',
      'client-fingerprint': 'chrome',
      servername: 'x1.vchannel.dpdns.org',
      sni: 'x1.vchannel.dpdns.org',
      alpn: ['http/1.1'],
      'skip-cert-verify': true
    });

    expect(node['ws-opts']).toMatchObject({
      path: '/wsx1a1/',
      headers: { Host: 'x1.vchannel.dpdns.org' }
    });
  });

  it('correctly decodes percent-encoded passwords', () => {
    const node = normalizeTrojanNode({
      type: 'trojan',
      password: 'DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn%25252BE%25253D'
    });
    expect(node.password).toBe('DC2vJc4y1bHWbciVbQ9zJRCJjye5xHlidFoj6GaGn+E=');
  });
});
