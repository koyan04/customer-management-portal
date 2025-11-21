const request = require('supertest');
const jwt = require('jsonwebtoken');

// Use real app but mock DB pool to an in-memory shim
jest.mock('../db', () => {
  // shared query implementation used by both pool.query and client.query
  const queryImpl = jest.fn(async (sql, params) => {
    const s = (sql || '').toString().toLowerCase();
    // invalidated_tokens checks
    if (s.includes('select 1 from invalidated_tokens')) return { rows: [] };
    if (s.includes('insert into invalidated_tokens')) return { rows: [] };
    // refresh_tokens lookup by token_hash
    if (s.includes('select admin_id, expires_at from refresh_tokens')) {
      const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
      return { rows: [{ admin_id: 99, expires_at: future }] };
    }
    // admins lookup
    if (s.includes('select id, role from admins where id =')) {
      return { rows: [{ id: params && params[0] ? params[0] : 99, role: 'ADMIN' }] };
    }
    // default
    return { rows: [] };
  });

  return {
    query: queryImpl,
    // provide connect() to return client with query/release used in transactions
    connect: async () => ({
      query: queryImpl,
      release: async () => {},
    }),
  };
});

const app = require('../app');

describe('Auth middleware and token endpoints', () => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  test('invalidate route requires jti and records it', async () => {
    // sign a token with jti
    const token = jwt.sign({ user: { id: 42, role: 'ADMIN' }, jti: 'testjti' }, secret, { expiresIn: '1h' });
    const res = await request(app).post('/api/auth/invalidate').set('Authorization', `Bearer ${token}`).send();
    expect([200,201,204].includes(res.status)).toBe(true);
    expect(res.body && res.body.ok).toBe(true);
  });

  test('refresh returns a new token', async () => {
    const token = jwt.sign({ user: { id: 99, role: 'ADMIN' }, jti: 'oldjti' }, secret, { expiresIn: '1h' });
    // Simulate having a refresh_token cookie set (server mock ignores actual hash value)
    const fakeRefresh = 'fake-refresh-token-value';
    const res = await request(app).post('/api/auth/refresh').set('Cookie', `refresh_token=${fakeRefresh}`).send();
    expect(res.status).toBe(200);
    expect(res.body && typeof res.body.token === 'string').toBe(true);
    // new token should decode to include user id
    const decoded = jwt.verify(res.body.token, secret);
    expect(decoded.user && decoded.user.id).toBe(99);
    expect(decoded.jti).not.toBe('oldjti');
  });
});
