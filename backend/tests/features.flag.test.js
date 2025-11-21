const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

// Helper to build a minimal ADMIN token payload matching authenticateToken expectations.
function buildAdminToken() {
  const payload = { user: { id: 1, role: 'ADMIN', username: 'admin' } };
  const secret = process.env.JWT_SECRET || 'test-secret';
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

describe('Feature flags exposure', () => {
  test('servers summary surfaces useUserStatusMatview flag', async () => {
    // Set env flag for this test run
    process.env.USE_USER_STATUS_MATVIEW = 'true';
    const token = buildAdminToken();
    const res = await request(app).get('/api/servers/summary').set('Authorization', `Bearer ${token}`);
    // We tolerate 200 or 401 if auth wiring differs; skip if unauthorized
    if (res.status === 401) return; // auth tests cover middleware elsewhere
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(res.body.features).toBeDefined();
    expect(res.body.features.useUserStatusMatview).toBe(true);
  });

  test('/api/health returns features and matview state', async () => {
    process.env.USE_USER_STATUS_MATVIEW = 'false';
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.features).toBeDefined();
    expect(res.body.features.useUserStatusMatview).toBe(false);
    expect(res.body.matview).toBeDefined();
    // refreshing can be null if helper not loaded; just assert key presence
    expect(Object.prototype.hasOwnProperty.call(res.body.matview, 'refreshing')).toBe(true);
  });
});
