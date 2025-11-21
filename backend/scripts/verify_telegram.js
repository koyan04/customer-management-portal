require('dotenv').config();
const axios = require('axios');
const pool = require('../db');

(async function(){
  try {
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    if (!r.rows || r.rows.length === 0) {
      console.error('No telegram settings found in app_settings');
      process.exit(2);
    }
    const cfg = r.rows[0].data || {};
    const token = cfg.botToken || cfg.token || process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    const defaultChat = cfg.default_chat_id || cfg.defaultChatId || cfg.defaultChat || cfg.chat_id || cfg.chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || process.env.DEFAULT_CHAT_ID;
    if (!token) {
      console.error('No token configured in DB or env');
      process.exit(3);
    }
    const apiBase = `https://api.telegram.org/bot${token}`;
    // getMe
    try {
      const gm = await axios.get(`${apiBase}/getMe`);
      if (gm.data && gm.data.ok && gm.data.result) {
        const res = gm.data.result;
        console.log('[VERIFY] getMe OK — username=%s id=%s', res.username || 'N/A', res.id || 'N/A');
      } else {
        console.error('[VERIFY] getMe returned unexpected response');
      }
    } catch (e) {
      console.error('[VERIFY] getMe failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
      process.exit(4);
    }

    if (defaultChat) {
      try {
        await axios.post(`${apiBase}/sendMessage`, { chat_id: defaultChat, text: `CMP test message at ${new Date().toISOString()}` });
        console.log('[VERIFY] test message sent to default chat id %s', defaultChat);
      } catch (e) {
        console.error('[VERIFY] sendMessage failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
        process.exit(5);
      }
    } else {
      console.log('[VERIFY] no default chat id configured; skipping sendMessage');
    }
    process.exit(0);
  } catch (e) {
    console.error('[VERIFY] unexpected error:', e && e.message ? e.message : e);
    process.exit(10);
  }
})();
