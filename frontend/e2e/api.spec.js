import { test, expect } from '@playwright/test';

test.describe('Post-install API checks', () => {
  test('health endpoint returns expected version and status', async ({ request }) => {
    const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
    const token = process.env.E2E_ADMIN_TOKEN || '';
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const resp = await request.get(`${base.replace(/\/$/, '')}/api/health`, { headers });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    // Expect a version string containing '1.3.0' (adjust if you update VERSION file)
    if (process.env.E2E_EXPECT_VERSION) {
      const val = String((body && (body.versions && body.versions.appVersion)) || (body && body.version) || '');
      expect(val).toContain(process.env.E2E_EXPECT_VERSION);
    }
  });

  test('internal bot status endpoint accessible with token', async ({ request }) => {
    const base = process.env.E2E_BASE_URL || 'http://localhost:3000';
    const token = process.env.E2E_ADMIN_TOKEN || '';
    if (!token) {
      test.skip('No admin token provided');
    }
    const resp = await request.get(`${base.replace(/\/$/, '')}/internal/bot/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(resp.status()).toBeGreaterThanOrEqual(200);
    expect(resp.status()).toBeLessThan(500);
  });
});
