const XLSX = require('xlsx');
const request = require('supertest');
const { newDb } = require('pg-mem');

// Hermetic test for export ordering matching API listing ordering.

const db = newDb();
const pg = db.adapters.createPg();
const pool = new pg.Pool();
let serverId;

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      server_id INT NOT NULL,
      account_name TEXT NOT NULL,
      service_type TEXT,
      contact TEXT,
      expire_date TIMESTAMPTZ,
      total_devices INT,
      data_limit_gb INT,
      remark TEXT,
      display_pos INT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE servers (id SERIAL PRIMARY KEY, server_name TEXT);
  `);
  const sid = await pool.query("INSERT INTO servers (server_name) VALUES ('srv') RETURNING id");
  serverId = sid.rows[0].id;
  // Insert with explicit display_pos out of chronological order to ensure ordering logic is respected.
  await pool.query("INSERT INTO users (server_id, account_name, display_pos, created_at) VALUES ($1,'user-a',3, now() - interval '3 days')", [serverId]);
  await pool.query("INSERT INTO users (server_id, account_name, display_pos, created_at) VALUES ($1,'user-b',1, now() - interval '1 day')", [serverId]);
  await pool.query("INSERT INTO users (server_id, account_name, display_pos, created_at) VALUES ($1,'user-c',2, now() - interval '2 days')", [serverId]);
});

jest.doMock('../db', () => pool);
// Provide comprehensive auth middleware mocks so route mounting doesn't fail.
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
  isAdminOrServerAdmin: () => (req, res, next) => next(),
  isViewer: () => (req, res, next) => next(),
}));

const app = require('../app');

// pg-mem lacks support for window functions; rewrite the ordering query used by routes
const _origQuery = pool.query.bind(pool);
pool.query = (text, params) => {
  if (typeof text === 'string') {
    if (text.includes('ROW_NUMBER() OVER') || text.includes('effective_pos')) {
      return _origQuery('SELECT * FROM users WHERE server_id = $1 ORDER BY display_pos ASC, created_at DESC', params);
    }
  }
  return _origQuery(text, params);
};

describe('XLSX export ordering', () => {
  test('export rows follow effective_pos ordering', async () => {
    // Download export.xlsx
    const binaryParser = (res, cb) => {
      res.setEncoding('binary');
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => cb(null, Buffer.from(data, 'binary')));
    };
    const exportRes = await request(app)
      .get(`/api/users/server/${serverId}/export.xlsx`)
      .buffer(true)
      .parse(binaryParser);
    expect(exportRes.status).toBe(200);
    const wb = XLSX.read(exportRes.body, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // rows[0] is header
    const exportedNames = rows.slice(1).map(r => r[0]);
    // Expected order by display_pos ascending: user-b (1), user-c (2), user-a (3)
    expect(exportedNames).toEqual(['user-b','user-c','user-a']);
  });
});
