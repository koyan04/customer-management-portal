const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const pool = require('../db');

function makeAdminAuth() {
  const payload = { user: { id: 1, role: 'ADMIN' }, jti: 'testjti3' };
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
  // Seed an update origin value
  await pool.query("INSERT INTO app_settings (settings_key, data) VALUES ('update', '{" +
    "\"originUrl\":\"https://example.com/repo.git\"}'::jsonb) ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data;");
});

afterAll(async () => { try { await pool.end(); } catch (_) {} });

describe('Update status endpoint', () => {
  it('returns both gitOrigin (nullable) and storedOrigin', async () => {
    const res = await request(app)
      .get('/api/admin/control/update/status')
      .set(makeAdminAuth());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('gitOrigin');
    expect(res.body).toHaveProperty('storedOrigin');
    expect(res.body.storedOrigin).toBe('https://example.com/repo.git');
  });
});
