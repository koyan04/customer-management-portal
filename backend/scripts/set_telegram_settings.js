require('dotenv').config();
const axios = require('axios');
const pool = require('../db');

async function main() {
  const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const defaultChat = process.env.DEFAULT_CHAT_ID || process.env.TELEGRAM_DEFAULT_CHAT_ID;
  const botUsername = process.env.BOT_USERNAME || process.env.TELEGRAM_BOT_USERNAME || null;
  if (!token) {
    console.error('Missing BOT_TOKEN in env');
    process.exit(1);
  }

  const data = {
    // store both common key names to be tolerant of UI/backends
    token: token,
    botToken: token,
    bot_username: botUsername,
  };
  if (defaultChat) {
    const n = Number(defaultChat);
    data.default_chat_id = Number.isFinite(n) ? n : defaultChat;
  }

  try {
    await pool.query(
      `INSERT INTO app_settings (settings_key, data, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (settings_key) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      ['telegram', data, null]
    );
    console.log('[SETTINGS] upserted telegram settings');
  } catch (e) {
    console.error('[SETTINGS] failed to upsert telegram settings:', e && e.message ? e.message : e);
    process.exit(2);
  }

  // validate token using getMe
  try {
    const r = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    if (r.data && r.data.ok && r.data.result) {
      console.log('[TELEGRAM] getMe OK, username=%s id=%s', r.data.result.username || 'N/A', r.data.result.id || 'N/A');
    } else {
      console.error('[TELEGRAM] getMe returned unexpected response', r.data);
      process.exit(3);
    }
  } catch (e) {
    console.error('[TELEGRAM] getMe failed:', e && e.response ? e.response.data : e && e.message ? e.message : e);
    process.exit(3);
  }

  // send a short test message to the default chat id if present
  if (data.default_chat_id) {
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: data.default_chat_id,
        text: `Customer Management Portal: test message at ${new Date().toISOString()}`,
        parse_mode: 'HTML'
      });
      console.log('[TELEGRAM] test message sent to', data.default_chat_id);
    } catch (e) {
      console.error('[TELEGRAM] failed to send test message:', e && e.response ? e.response.data : e && e.message ? e.message : e);
      // don't exit with failure because settings are stored; continue
    }
  } else {
    console.log('[TELEGRAM] no default_chat_id configured; skipping test message send');
  }

  process.exit(0);
}

main().catch(e => { console.error('unexpected error:', e && e.stack ? e.stack : e); process.exit(10); });
