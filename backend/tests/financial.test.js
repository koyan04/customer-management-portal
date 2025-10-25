const request = require('supertest');

// Mock auth to bypass JWT in unit tests
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
}));

// Mock the DB pool so we can return controlled rows and test historical pricing logic
jest.mock('../db', () => ({
  query: jest.fn(),
}));

const pool = require('../db');
const app = require('../app');

describe('Financial API historical pricing', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('uses prices from settings_audit for each month (no retroactive re-pricing)', async () => {
    // craft rows similar to what the single SQL returns: month_start, service_type, cnt, audit_after, current_app
    const rows = [
      // 2025-08: 2 Mini, 1 Basic at prices 3.50 and 4.00
      { month_start: '2025-08-01T00:00:00.000Z', service_type: 'mini', cnt: 2, audit_after: { price_mini_cents: 350, price_basic_cents: 400, price_unlimited_cents: 0, currency: 'USD' }, current_app: null },
      { month_start: '2025-08-01T00:00:00.000Z', service_type: 'basic', cnt: 1, audit_after: { price_mini_cents: 350, price_basic_cents: 400, price_unlimited_cents: 0, currency: 'USD' }, current_app: null },
      // 2025-09: price updated to 4.00 and 5.00; different counts
      { month_start: '2025-09-01T00:00:00.000Z', service_type: 'mini', cnt: 1, audit_after: { price_mini_cents: 400, price_basic_cents: 500, price_unlimited_cents: 0, currency: 'USD' }, current_app: null },
      { month_start: '2025-09-01T00:00:00.000Z', service_type: 'basic', cnt: 2, audit_after: { price_mini_cents: 400, price_basic_cents: 500, price_unlimited_cents: 0, currency: 'USD' }, current_app: null },
    ];

    // The admin route executes a single pool.query for its aggregate SQL; return our rows
    pool.query.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/admin/financial');
    expect(res.status).toBe(200);

    const months = res.body.months || [];
    // find the months we inserted
    const aug = months.find(m => m.month === '2025-08');
    const sep = months.find(m => m.month === '2025-09');

    expect(aug).toBeDefined();
    expect(sep).toBeDefined();

    const augExpected = (2 * 350) + (1 * 400); // 2 mini @350 + 1 basic @400
    const sepExpected = (1 * 400) + (2 * 500); // 1 mini @400 + 2 basic @500

    expect(Number(aug.revenue_cents)).toBe(augExpected);
    expect(Number(sep.revenue_cents)).toBe(sepExpected);
  });
});
