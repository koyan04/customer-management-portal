const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const pool = require('../db');

function makeAdminAuth() {
  const payload = { user: { id: 1, role: 'ADMIN' }, jti: 'testjti2' };
  const secret = process.env.JWT_SECRET || 'test-secret';
  const token = jwt.sign(payload, secret, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    display_name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    avatar_data TEXT,
    role TEXT NOT NULL DEFAULT 'VIEWER',
    created_at TIMESTAMP DEFAULT now()
  );`);
  await pool.query("INSERT INTO admins (id, display_name, username, password_hash, role) VALUES (1,'Admin','admin','x','ADMIN') ON CONFLICT (id) DO NOTHING;");
  await pool.query("CREATE TABLE IF NOT EXISTS app_settings (settings_key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_by INTEGER, updated_at TIMESTAMPTZ DEFAULT now());");
});

afterAll(async () => { try { await pool.end(); } catch (_) {} });

describe('Cert config persistence', () => {
  it('saves domain/email/token and returns masked token on GET', async () => {
    const body = { domain: 'example.test', email: 'ops@example.test', api_token: 'secret-token' };
    const putRes = await request(app)
      .put('/api/admin/control/cert/config')
      .set(makeAdminAuth())
      .send(body);
    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);

    const getRes = await request(app)
      .get('/api/admin/control/cert/config')
      .set(makeAdminAuth());
    expect(getRes.status).toBe(200);
    expect(getRes.body.ok).toBe(true);
    expect(getRes.body.config.domain).toBe('example.test');
    expect(getRes.body.config.email).toBe('ops@example.test');
    // token should be masked
    expect(getRes.body.config.api_token).toBe('********');
  });
});
