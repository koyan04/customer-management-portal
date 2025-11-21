const request = require('supertest');
const { newDb } = require('pg-mem');

// Verify export/template filenames use server_name instead of id.

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
    CREATE TABLE settings_audit (
      id SERIAL PRIMARY KEY,
      admin_id INT,
      settings_key TEXT,
      action TEXT,
      before_data JSONB,
      after_data JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE server_admin_permissions (admin_id INT, server_id INT);
  `);
  const sid = await pool.query("INSERT INTO servers (server_name) VALUES ('YN Paradise SG03') RETURNING id");
  serverId = sid.rows[0].id;
  await pool.query("INSERT INTO users (server_id, account_name, display_pos) VALUES ($1,'user-a',1)", [serverId]);
});

jest.doMock('../db', () => pool);
// Auth middleware mocks to bypass auth and allow access
jest.mock('../middleware/authMiddleware', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 1, role: 'ADMIN' }; next(); },
  isAdmin: (req, res, next) => next(),
  isServerAdminOrGlobal: () => (req, res, next) => next(),
}));

const app = require('../app');

describe('XLSX export/template filenames', () => {
  test('export.xlsx Content-Disposition uses server_name', async () => {
    const res = await request(app).get(`/api/users/server/${serverId}/export.xlsx`);
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'] || '';
    expect(cd).toContain('attachment;');
    expect(cd).toContain('filename="YN Paradise SG03 - users.xlsx"');
  });

  test('template.xlsx Content-Disposition uses server_name', async () => {
    const res = await request(app).get(`/api/users/server/${serverId}/template.xlsx`);
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'] || '';
    expect(cd).toContain('attachment;');
    expect(cd).toContain('filename="YN Paradise SG03 - template.xlsx"');
  });
});
