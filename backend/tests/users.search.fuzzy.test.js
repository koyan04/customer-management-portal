const request = require('supertest');
const { newDb } = require('pg-mem');

// Fuzzy search fallback test (pg-mem lacks pg_trgm similarity)

const db = newDb();
const pg = db.adapters.createPg();
const pool = new pg.Pool();

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE admins (id SERIAL PRIMARY KEY, role TEXT);
    CREATE TABLE servers (id SERIAL PRIMARY KEY, server_name TEXT);
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
    CREATE TABLE viewer_server_permissions (editor_id INT, server_id INT);
    CREATE TABLE server_admin_permissions (admin_id INT, server_id INT);
  `);
  await pool.query("INSERT INTO admins (role) VALUES ('ADMIN') RETURNING id");
  const s = await pool.query("INSERT INTO servers (server_name) VALUES ('SearchSrv') RETURNING id");
  const sid = s.rows[0].id;
  await pool.query("INSERT INTO users (server_id, account_name, service_type, contact, expire_date, remark) VALUES ($1,'john_doe','Mini','c1', now() + interval '2 days','r1')", [sid]);
  await pool.query("INSERT INTO users (server_id, account_name, service_type, contact, expire_date, remark) VALUES ($1,'joan_d','Basic','c2', now() - interval '1 day','r2')", [sid]);
  await pool.query("INSERT INTO users (server_id, account_name, service_type, contact, expire_date, remark) VALUES ($1,'johanna','Unlimited','c3', now() + interval '3 days','r3')", [sid]);
});

jest.doMock('../db', () => pool);
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
}));

const app = require('../app');

describe('GET /api/users/search fuzzy fallback', () => {
  test('fuzzy=1 still returns substring matches and status field', async () => {
    const res = await request(app).get('/api/users/search?q=john&fuzzy=1');
    expect(res.status).toBe(200);
    const names = res.body.map(r => r.account_name).sort();
  // Sorted result should have johanna before john_doe
  expect(names).toEqual(['johanna','john_doe']);
    // status field present
    expect(res.body[0]).toHaveProperty('status');
  });
});
