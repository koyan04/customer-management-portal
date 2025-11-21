const request = require('supertest');
const { newDb } = require('pg-mem');

// Tests for /api/users/search endpoint

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
  // Admin user
  await pool.query("INSERT INTO admins (role) VALUES ('ADMIN') RETURNING id");
  // Servers
  const s1 = await pool.query("INSERT INTO servers (server_name) VALUES ('Alpha') RETURNING id");
  const s2 = await pool.query("INSERT INTO servers (server_name) VALUES ('Beta') RETURNING id");
  const sid1 = s1.rows[0].id; const sid2 = s2.rows[0].id;
  // Users across servers
  await pool.query("INSERT INTO users (server_id, account_name, service_type) VALUES ($1,'john_doe','Mini')", [sid1]);
  await pool.query("INSERT INTO users (server_id, account_name, service_type) VALUES ($1,'jane_smith','Basic')", [sid1]);
  await pool.query("INSERT INTO users (server_id, account_name, service_type) VALUES ($1,'johnny_appleseed','Unlimited')", [sid2]);
});

jest.doMock('../db', () => pool);
// Auth middleware mock
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
}));

const app = require('../app');

describe('GET /api/users/search', () => {
  test('requires minimum query length', async () => {
    const res = await request(app).get('/api/users/search?q=j');
    expect(res.status).toBe(400);
  });
  test('returns matching users for substring', async () => {
    const res = await request(app).get('/api/users/search?q=john');
    expect(res.status).toBe(200);
    const names = res.body.map(r => r.account_name).sort();
    expect(names).toEqual(['john_doe','johnny_appleseed']);
  });
  test('case-insensitive matching', async () => {
    const res = await request(app).get('/api/users/search?q=JANE');
    expect(res.status).toBe(200);
    expect(res.body.map(r => r.account_name)).toEqual(['jane_smith']);
  });
});
