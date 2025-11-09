const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const pool = require('../db');

// Create a signed ADMIN token so authMiddleware accepts it
function makeAdminAuth() {
  const payload = { user: { id: 1, role: 'ADMIN' }, jti: 'testjti' };
  const secret = process.env.JWT_SECRET || 'test-secret';
  const token = jwt.sign(payload, secret, { expiresIn: '1h' });
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  // Recreate minimal admins table respecting schema (include password_hash)
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

afterAll(async () => {
  try { await pool.end(); } catch (_) {}
});

describe('Update source persistence', () => {
  it('persists originUrl and returns it on GET', async () => {
    const testUrl = 'https://example.com/repo.git';
    const putRes = await request(app)
      .put('/api/admin/control/update/source')
      .set(makeAdminAuth())
      .send({ url: testUrl });
    expect([200,207]).toContain(putRes.status);
    expect(putRes.body.ok).toBe(true);
    const getRes = await request(app)
      .get('/api/admin/control/update/source')
      .set(makeAdminAuth());
    expect(getRes.status).toBe(200);
    expect(getRes.body.originUrl).toBe(testUrl);
  });
});
