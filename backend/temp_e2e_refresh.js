require('dotenv').config();
const jwt = require('jsonwebtoken');
const app = require('./app');
const request = require('supertest');
const pool = require('./db');

(async () => {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET missing');
    const jti = require('crypto').randomBytes(8).toString('hex');
    const token = jwt.sign({ user: { id: 1, role: 'ADMIN' }, jti }, secret, { expiresIn: '24h' });
    console.log('Original token payload:', jwt.decode(token));

    // Call refresh
    const res = await request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`).send();
    console.log('/api/auth/refresh status', res.status, 'body:', res.body);
    if (res.status === 200 && res.body && res.body.token) {
      const newPayload = jwt.decode(res.body.token);
      console.log('New token payload:', newPayload);
    }

    // Call invalidate
    const inv = await request(app).post('/api/auth/invalidate').set('Authorization', `Bearer ${token}`).send();
    console.log('/api/auth/invalidate status', inv.status, 'body:', inv.body);

    // Check DB for invalidated token row
    try {
      const r = await pool.query('SELECT jti, admin_id, invalidated_at FROM invalidated_tokens WHERE jti = $1', [jti]);
      console.log('DB invalidated_tokens rows:', r.rows);
    } catch (dbErr) {
      console.error('DB check failed:', dbErr && dbErr.message ? dbErr.message : dbErr);
    }

    // cleanup and exit
    try { await pool.end(); } catch (_) {}
    process.exit(0);
  } catch (e) {
    console.error('E2E script error', e && e.stack ? e.stack : e);
    try { await pool.end(); } catch (_) {}
    process.exit(2);
  }
})();
