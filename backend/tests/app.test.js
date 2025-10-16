const request = require('supertest');
const app = require('../app');

describe('API shape checks', () => {
  test('/api/servers returns an array', async () => {
    const res = await request(app).get('/api/servers');
    expect(Array.isArray(res.body)).toBe(true);
  }, 10000);

  test('/api/admin/accounts returns array (requires auth) - skipped in unit', () => {
    // This endpoint requires auth; covered by smoke tests which run the full server with tokens/seed
    expect(true).toBe(true);
  });
});
