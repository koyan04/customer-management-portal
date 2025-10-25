require('dotenv').config();
const pool = require('./db');
const { validateSettings } = require('./lib/validateSettings');

(async () => {
  try {
    const key = 'general';
    // actor admin id: try find first admin
    const admins = await pool.query('SELECT id FROM admins ORDER BY id LIMIT 1');
    const adminId = admins.rows && admins.rows[0] ? admins.rows[0].id : null;
    console.log('Using admin id:', adminId);

    // read before
    const beforeRes = await pool.query('SELECT data FROM app_settings WHERE settings_key = $1', [key]);
    const before = beforeRes.rows && beforeRes.rows[0] ? beforeRes.rows[0].data : null;
    console.log('\n--- BEFORE ---\n', JSON.stringify(before, null, 2));

    // Prepare payload with decimal prices and cents
    const payload = { ...(before || {}) };
    payload.currency = 'USD';
    payload.price_mini = 3.5;
    payload.price_basic = 4.0;
    payload.price_unlimited = 0;
    payload.price_mini_cents = Math.round(payload.price_mini * 100);
    payload.price_basic_cents = Math.round(payload.price_basic * 100);
    payload.price_unlimited_cents = Math.round(payload.price_unlimited * 100);

    console.log('\nPayload to validate:\n', JSON.stringify(payload, null, 2));

    const { ok, errors, cleaned } = validateSettings(key, payload);
    if (!ok) {
      console.error('Validation failed:', errors);
      process.exit(2);
    }

    // Merge preserving non-validated fields like logo_url etc (same as route)
    const toStore = { ...(before || {}), ...cleaned };

    // Upsert
    const upRes = await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING data`,
      [key, toStore, adminId]
    );
    const after = upRes.rows && upRes.rows[0] ? upRes.rows[0].data : toStore;

    // Write audit (masked using same inline mask as admin.js would)
    const maskSecrets = (k, data) => {
      if (!data || typeof data !== 'object') return data;
      const clone = JSON.parse(JSON.stringify(data));
      if (k === 'database') if (clone.password) clone.password = '********';
      if (k === 'telegram') if (clone.botToken) clone.botToken = '********';
      if (k === 'remoteServer') {
        if (clone.password) clone.password = '********';
        if (clone.privateKey) clone.privateKey = '********';
        if (clone.passphrase) clone.passphrase = '********';
      }
      return clone;
    };

    try {
      await pool.query('INSERT INTO settings_audit (admin_id, settings_key, action, before_data, after_data) VALUES ($1,$2,$3,$4,$5)', [adminId, key, 'UPDATE', maskSecrets(key, before), maskSecrets(key, after)]);
    } catch (e) { console.warn('Failed to write audit:', e && e.message ? e.message : e); }

    console.log('\n--- AFTER ---\n', JSON.stringify(after, null, 2));

    const auditRows = await pool.query("SELECT id, admin_id, action, created_at, after_data FROM settings_audit WHERE settings_key = $1 ORDER BY created_at DESC LIMIT 5", [key]);
    console.log('\n--- Recent settings_audit (latest 5) ---\n', JSON.stringify(auditRows.rows || [], null, 2));

    process.exit(0);
  } catch (err) {
    console.error('In-process E2E failed:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
