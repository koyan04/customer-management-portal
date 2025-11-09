require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');
const axios = require('axios');

(async function(){
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    const cfg = (r.rows && r.rows[0] && r.rows[0].data) || {};
    const token = cfg.botToken || cfg.token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('No token found in app_settings.telegram or env');
      process.exit(2);
    }
    const api = `https://api.telegram.org/bot${token}`;
    const res = await axios.get(`${api}/getUpdates`, { params: { limit: 50 } });
    console.log('getUpdates result:', JSON.stringify(res.data, null, 2).slice(0, 20000));
    await pool.end();
  } catch (e) {
    console.error('ERROR contacting Telegram/getUpdates:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    process.exit(3);
  }
})();
