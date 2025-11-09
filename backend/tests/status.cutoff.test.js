const request = require('supertest');

// Mock DB and auth to simulate ADMIN and control returned rows for cutoff logic
jest.mock('../db', () => {
  const calls = [];
  const query = jest.fn(async (text, params) => {
    const sql = String(text);
    calls.push([sql, params]);
    // Servers list queries
    if (/FROM servers\b/.test(sql) && /SELECT id, server_name, ip_address, domain_name/.test(sql)) {
      return { rows: [ { id: 1, server_name: 'Alpha', ip_address: '1.2.3.4', domain_name: 'alpha.local', created_at: new Date().toISOString() } ] };
    }
    // servers summary: user rows fetch
    if (/SELECT u\.server_id, u\.service_type, u\.expire_date\s+FROM users/i.test(sql)) {
      // build three users relative to "today"
      const now = new Date();
      const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
      const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
      const today = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      const plus2 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
      return { rows: [
        { server_id: 1, service_type: 'basic', expire_date: yesterday, account_name: 'old' }, // expired
        { server_id: 1, service_type: 'mini', expire_date: today, account_name: 'today' },     // soon
        { server_id: 1, service_type: 'unlimited', expire_date: plus2, account_name: 'later' } // active
      ] };
    }
    // by-status: check for matview existence -> return null to skip
    if (/to_regclass\('public\.user_status_matview'\)/.test(sql)) {
      return { rows: [ { name: null } ] };
    }
    // by-status live JOIN query: force a failure to trigger fallback path
    if (/FROM users u\s+JOIN servers s/i.test(sql)) {
      const err = new Error('simulate live join failure');
      err.code = 'XXTEST';
      throw err;
    }
    // by-status fallback: list servers
    if (/SELECT id, server_name, ip_address, domain_name FROM servers\b/.test(sql)) {
      return { rows: [ { id: 1, server_name: 'Alpha', ip_address: '1.2.3.4', domain_name: 'alpha.local' } ] };
    }
    // by-status fallback: users per server
    if (/SELECT \* FROM users WHERE server_id = \$1/.test(sql)) {
      const now = new Date();
      const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
      const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
      const today = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
      const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
      const plus2 = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
      return { rows: [
        { id: 11, server_id: 1, account_name: 'old', service_type: 'basic', expire_date: yesterday },
        { id: 12, server_id: 1, account_name: 'today', service_type: 'mini', expire_date: today },
        { id: 13, server_id: 1, account_name: 'later', service_type: 'unlimited', expire_date: plus2 },
      ] };
    }
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

describe('End-of-day cutoff status classification', () => {
  test('servers summary uses cutoff: expired <=0h, soon <=24h, active >24h', async () => {
    const res = await request(app).get('/api/servers/summary');
    expect(res.status).toBe(200);
    const body = res.body || JSON.parse(res.text);
    expect(body.status).toEqual({ active: 1, soon: 1, expired: 1 });
    expect(Array.isArray(body.servers)).toBe(true);
    const s = body.servers[0];
    expect(s.status).toEqual({ active: 1, soon: 1, expired: 1 });
  });

  test('by-status expired returns only yesterday (cutoff today 00:00)', async () => {
    const res = await request(app).get('/api/users/by-status/expired');
    expect(res.status).toBe(200);
    const list = res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.map(u => u.account_name)).toEqual(['old']);
  });

  test('by-status soon returns only today (cutoff before +24h)', async () => {
    const res = await request(app).get('/api/users/by-status/soon');
    expect(res.status).toBe(200);
    const list = res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.map(u => u.account_name)).toEqual(['today']);
  });

  test('by-status active returns only +2 days', async () => {
    const res = await request(app).get('/api/users/by-status/active');
    expect(res.status).toBe(200);
    const list = res.body;
    expect(Array.isArray(list)).toBe(true);
    expect(list.map(u => u.account_name)).toEqual(['later']);
  });
});
