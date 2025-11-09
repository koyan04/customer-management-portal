const pool = require('../backend/db');
(async () => {
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    console.log('telegram settings row:', JSON.stringify(r.rows && r.rows[0] && r.rows[0].data, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
