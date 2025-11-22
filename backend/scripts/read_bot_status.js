require('dotenv').config();
const pool = require('../db');

(async function(){
  try {
    const r = await pool.query("SELECT data, updated_at FROM app_settings WHERE settings_key = 'telegram_bot_status' ORDER BY updated_at DESC LIMIT 1");
    console.log(JSON.stringify(r.rows || [], null, 2));
  } catch (e) {
    console.error('ERR', e && e.message ? e.message : e);
  } finally {
    try { await pool.end(); } catch (_) {}
    process.exit(0);
  }
})();
