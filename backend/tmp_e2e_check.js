require('dotenv').config();
const pool = require('./db');
const jwt = require('jsonwebtoken');

const fetch = globalThis.fetch || (url => { throw new Error('fetch not available') });

async function waitForServer(url, tries = 10, ms = 500) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status === 401 || r.status === 200) return true; // server responding
    } catch (e) {
      // ignore
    }
    await new Promise(r => setTimeout(r, ms));
  }
  return false;
}

(async () => {
  try {
    // find an admin id
    const a = await pool.query('SELECT id, role FROM admins ORDER BY id LIMIT 1');
    if (!a.rows || a.rows.length === 0) {
      console.error('No admin found in DB. Please run seedAdmin.js first.');
      process.exit(2);
    }
    const admin = a.rows[0];
    console.log('Found admin:', admin);

    // ensure JWT secret
    const secret = process.env.JWT_SECRET || 'devsecret';
    if (!process.env.JWT_SECRET) console.warn('Warning: using fallback JWT_SECRET=devsecret for this run');

    const token = jwt.sign({ user: { id: admin.id, role: admin.role } }, secret, { expiresIn: '24h' });
    const base = 'http://localhost:3001/api/admin/settings/general';

    const serverReady = await waitForServer(base, 20, 300);
    if (!serverReady) {
      console.error('Server not responding at', base);
      process.exit(3);
    }

    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    console.log('\n--- GET current settings (before) ---');
    const beforeResp = await fetch(base, { headers });
    const before = await beforeResp.json();
    console.log('GET status', beforeResp.status);
    console.log(JSON.stringify(before, null, 2));

    const payload = before.data && typeof before.data === 'object' ? { ...before.data } : {};
    payload.title = payload.title || 'YN Paradise';
    payload.currency = 'USD';
    payload.price_mini = 3.5;
    payload.price_basic = 4.0;
    payload.price_unlimited = 0;
    payload.price_mini_cents = Math.round(payload.price_mini * 100);
    payload.price_basic_cents = Math.round(payload.price_basic * 100);
    payload.price_unlimited_cents = Math.round(payload.price_unlimited * 100);

    console.log('\n--- PUT updated settings (sample prices) ---');
    const putResp = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(payload) });
    console.log('PUT status', putResp.status);
    const putBody = await putResp.text();
    try { console.log('PUT response JSON:', JSON.stringify(JSON.parse(putBody), null, 2)); } catch (e) { console.log('PUT response text:', putBody); }

    console.log('\n--- GET settings (after) ---');
    const afterResp = await fetch(base, { headers });
    console.log('GET status', afterResp.status);
    const after = await afterResp.json();
    console.log(JSON.stringify(after, null, 2));

    // print last few settings_audit entries for 'general'
    console.log('\n--- Recent settings_audit entries for general ---');
    const auditRes = await pool.query("SELECT id, admin_id, action, created_at, after_data FROM settings_audit WHERE settings_key = 'general' ORDER BY created_at DESC LIMIT 5");
    console.log(JSON.stringify(auditRes.rows || [], null, 2));

    process.exit(0);
  } catch (err) {
    console.error('E2E check failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
