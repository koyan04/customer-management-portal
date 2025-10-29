const request = require('supertest');

// Mock the DB and auth middleware so tests run deterministically without a real Postgres
jest.mock('../db', () => {
  const query = jest.fn((text, params) => {
    // first call: server_admin_permissions
    if (String(text).includes('SELECT server_id FROM server_admin_permissions')) {
      return Promise.resolve({ rows: [{ server_id: 4 }] });
    }
    // fallback: return a minimal row set representing one month
    return Promise.resolve({ rows: [ {
      month_start: new Date('2025-10-01T00:00:00.000Z'),
      service_type: 'mini',
      cnt: 1,
      audit_after: null,
      current_app: { currency: 'USD', price_mini_cents: 300000, price_basic_cents: 500000, price_unlimited_cents: 800000 }
    } ] });
  });
  return { query, end: jest.fn() };
});

jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 2, role: 'SERVER_ADMIN' }; return next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
}));

const app = require('../app');
const db = require('../db');

describe('GET /api/admin/financial (integration)', () => {
  test('allows SERVER_ADMIN to fetch server-scoped financials', async () => {
    const res = await request(app).get('/api/admin/financial');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('months');
    expect(Array.isArray(res.body.months)).toBe(true);
    expect(res.body.months.length).toBeGreaterThan(0);

    // Ensure we queried server_admin_permissions and then the aggregation SQL with the sids param
    expect(db.query.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(String(db.query.mock.calls[0][0])).toMatch(/SELECT server_id FROM server_admin_permissions/);
    // second call should include the bound params ([sids]) where sids contained 4
    expect(db.query.mock.calls[1][1]).toEqual([[4]]);
  });
});



