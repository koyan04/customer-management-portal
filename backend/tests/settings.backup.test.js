const request = require('supertest');
const app = require('../app');

// Minimal token stub: these tests are illustrative; in a real setup, seed and sign a valid JWT.
const ADMIN_BEARER = 'Bearer test-token';

// Mock authenticateToken and isAdmin to bypass auth in unit scope
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
}));

// Mock db queries narrowly for these endpoints
jest.mock('../db', () => {
  const { Pool } = require('pg');
  // create a very small mock with query method we can branch by sql
  const rows = {
    admins: [{ id: 1, display_name: 'Admin', username: 'admin', role: 'ADMIN', avatar_url: null, created_at: new Date().toISOString() }],
    servers: [{ id: 1, server_name: 'S1', created_at: new Date().toISOString() }],
    app_settings: [{ settings_key: 'database', data: { host: 'localhost', port: 5432, user: 'pg', database: 'db' }, updated_at: new Date().toISOString() }],
  };
  return {
    query: async (sql, params) => {
      sql = String(sql).toLowerCase();
      if (sql.includes('from admins') && sql.includes('select')) return { rows: rows.admins };
      if (sql.includes('from servers') && sql.includes('select') && !sql.includes('count')) return { rows: rows.servers };
      if (sql.includes('from app_settings') && sql.includes('select')) return { rows: rows.app_settings };
      if (sql.includes('insert into settings_audit')) return { rows: [] };
      if (sql.includes('insert into app_settings')) return { rows: [{ data: (params && params[1]) || {} }] };
      if (sql.includes('select count(*)') && sql.includes('from admins')) return { rows: [{ c: 1 }] };
      if (sql.includes('select count(*)') && sql.includes('from servers')) return { rows: [{ c: 1 }] };
      if (sql.includes('max(created_at)')) return { rows: [{ ts: new Date().toISOString() }] };
      if (sql.includes("from information_schema.tables")) return { rows: [{ c: 4 }] };
      return { rows: [] };
    },
    connect: async () => ({
      query: async (sql, params) => ({ rows: [] }),
      release: () => {}
    }),
  };
});

describe('Admin backup/restore endpoints', () => {
  it('should produce config backup json', async () => {
    const res = await request(app).get('/api/admin/backup/config').set('Authorization', ADMIN_BEARER);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/config-\d+.*\.json/);
    const body = JSON.parse(res.text);
    expect(body.type).toBe('config-backup-v1');
    expect(Array.isArray(body.app_settings)).toBe(true);
  });

  it('should produce db backup .db', async () => {
    const res = await request(app).get('/api/admin/backup/db').set('Authorization', ADMIN_BEARER);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/database-\d+.*\.db/);
  });
});
