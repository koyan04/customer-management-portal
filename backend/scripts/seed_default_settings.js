require('dotenv').config({ path: __dirname + '/../.env' });
const pool = require('../db');

async function upsert(key, data) {
  const json = JSON.stringify(data || {});
  const sql = `INSERT INTO app_settings (settings_key, data, updated_at)
               VALUES ($1, $2::jsonb, now())
               ON CONFLICT (settings_key)
               DO UPDATE SET data = app_settings.data || EXCLUDED.data, updated_at = now()`;
  await pool.query(sql, [key, json]);
}

async function ensureDefaults() {
  // General: keep defaults conservative; do not include any secret values
  const general = {
    title: 'Customer Management Portal',
    theme: 'system',
    currency: 'USD',
    showTooltips: true
  };

  // Database panel defaults (no password), UI-only hints
  const dbPanel = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER ? '***' : 'cmp',
    database: process.env.DB_DATABASE || 'cmp'
  };

  // Control panel service port default uses env PORT if set, else 3001
  const port = Number(process.env.PORT) || 3001;
  const panel = { port };

  // Telegram: disabled by default, no secrets
  const telegram = {
    enabled: false,
    bot_token: '',
    chat_id: ''
  };

  // Update channel
  const update = {
    channel: 'stable'
  };

  // Cert: disabled by default, no secrets
  const cert = {
    provider: 'none',
    email: '',
    staging: false
  };

  // Apply if missing or merge defaults (non-destructive)
  await upsert('general', general);
  await upsert('database', dbPanel);
  // Only create 'panel' if absent or missing port; merge keeps admin-changed values
  await upsert('panel', panel);
  await upsert('telegram', telegram);
  await upsert('update', update);
  await upsert('cert', cert);
}

(async () => {
  try {
    // Ensure app_settings table exists
    await pool.query("CREATE TABLE IF NOT EXISTS app_settings (settings_key TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_by INTEGER NULL, updated_at TIMESTAMP NOT NULL DEFAULT now())");
    await ensureDefaults();
    console.log('[seed_default_settings] default settings ensured');
    await pool.shutdown?.();
    process.exit(0);
  } catch (e) {
    console.error('[seed_default_settings] failed:', e && e.message ? e.message : e);
    try { await pool.shutdown?.(); } catch (_) {}
    process.exit(1);
  }
})();
