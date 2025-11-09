const request = require('supertest');

// Mock DB and auth to simulate ADMIN and capture SQL calls
jest.mock('../db', () => {
  const calls = [];
  const query = jest.fn(async (text, params) => {
    calls.push([String(text), params]);
    const sql = String(text);
    if (sql.includes('SELECT * FROM servers') && sql.includes('ORDER BY')) {
      // return two servers as if stored in DB
      return { rows: [
        { id: 1, server_name: 'Alpha', display_pos: 1, created_at: new Date().toISOString() },
        { id: 2, server_name: 'Beta', display_pos: 2, created_at: new Date().toISOString() },
      ] };
    }
    if (sql.includes('UPDATE servers') && sql.includes('FROM new_order')) {
      // pretend update succeeded
      return { rowCount: 2 };
    }
    // default empty
    return { rows: [] };
  });
  query.__calls = calls;
  return { query, end: jest.fn() };
});

jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; return next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
}));

const app = require('../app');
const db = require('../db');

describe('Server reorder integration (admin)', () => {
  beforeEach(() => { if (db.query.mockClear) db.query.mockClear(); });

  test('GET /api/servers returns ordered list', async () => {
    const res = await request(app).get('/api/servers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map(s => s.id)).toEqual([1, 2]);
    // Ensure order-by SQL was used
    const first = db.query.mock.calls[0][0];
    expect(String(first)).toMatch(/ORDER BY COALESCE\(display_pos/);
  });

  test('PUT /api/servers/order updates display_pos in provided order', async () => {
    const res = await request(app)
      .put('/api/servers/order')
      .send({ ids: [2, 1] })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    // Some environments may not populate res.body; safely parse from text if needed
    const payload = (res.body && Object.keys(res.body).length) ? res.body : (res.text ? JSON.parse(res.text) : {});
    expect(payload).toHaveProperty('ok', true);
    expect(payload).toHaveProperty('count', 2);
    // Confirm UPDATE uses unnest WITH ORDINALITY and correct param shape
    const call = db.query.mock.calls.find(([sql]) => String(sql).includes('WITH ORDINALITY'));
    expect(call).toBeTruthy();
    expect(call[1]).toEqual([[2, 1]]);
  });

  test('PUT /api/servers/order returns helpful error when display_pos column is missing', async () => {
    // Arrange: make the next UPDATE call throw undefined_column (42703)
    db.query.mockImplementationOnce(async () => {
      const err = new Error('column "display_pos" does not exist');
      err.code = '42703';
      throw err;
    });
    const res = await request(app)
      .put('/api/servers/order')
      .send({ ids: [1, 2] })
      .set('Content-Type', 'application/json');
    expect(res.status).toBe(500);
    const payload = (res.body && Object.keys(res.body).length) ? res.body : (res.text ? JSON.parse(res.text) : {});
    expect(String(payload.msg || '')).toMatch(/Migration missing|display_pos/i);
  });
});
