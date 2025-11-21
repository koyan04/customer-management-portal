require('dotenv').config({ path: __dirname + '/.env' });

(async function(){
  try {
    const pool = require('./db');
    const r = await pool.query("SELECT settings_key, data FROM app_settings WHERE settings_key IN ('telegram','telegram_bot_status')");
    console.log('app_settings rows:', JSON.stringify(r.rows, null, 2));
    // Also print environment-derived token if present
    console.log('ENV TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN || '(none)');
    // Close pool
    await pool.end();
  } catch (e) {
    console.error('ERROR:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
