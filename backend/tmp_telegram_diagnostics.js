require('dotenv').config();
const axios = require('axios');
(async function(){
  try{
    const pool = require('./db');
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key='telegram'");
    const cfg = r.rows && r.rows[0] && r.rows[0].data ? r.rows[0].data : {};
    const token = cfg.botToken || cfg.token || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) { console.error('No token found in DB or env'); process.exit(2); }
    const api = `https://api.telegram.org/bot${token}`;
    console.log('Using token from DB (masked):', `${String(token).slice(0,10)}...${String(token).slice(-6)}`);
    try {
      const me = await axios.get(`${api}/getMe`);
      console.log('/getMe ->', me.data);
    } catch (e) {
      console.error('/getMe failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    }
    try {
      const wh = await axios.get(`${api}/getWebhookInfo`);
      console.log('/getWebhookInfo ->', JSON.stringify(wh.data, null, 2));
    } catch (e) {
      console.error('/getWebhookInfo failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    }
    await pool.end();
  } catch (e) {
    console.error('ERR:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
