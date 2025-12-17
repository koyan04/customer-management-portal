const app = require('./app');
const pool = require('./db');

async function resolvePort() {
  // Prefer DB-configured port (app_settings.panel.port), fallback to legacy 'service.port', then env PORT, then 3001
  try {
    // Try new key first
    let d = {};
    try {
      const r1 = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'panel'");
      d = r1.rows && r1.rows[0] ? (r1.rows[0].data || {}) : {};
    } catch (_) {}
    if (!d || typeof d.port === 'undefined') {
      try {
        const rLegacy = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'service'");
        const ld = rLegacy.rows && rLegacy.rows[0] ? (rLegacy.rows[0].data || {}) : {};
        if (typeof ld.port !== 'undefined' && typeof d.port === 'undefined') d = ld;
      } catch (_) {}
    }
    const p = Number(d.port);
    if (Number.isFinite(p) && p >= 1 && p <= 65535) return p;
  } catch (e) {
    // ignore read errors and fallback to env/default
  }
  const envPort = Number(process.env.PORT) || 3001;
  return envPort;
}

let server;
async function start() {
  let chosen = await resolvePort();
  const forced = Number(process.env.FORCE_BACKEND_PORT);
  if (Number.isFinite(forced) && forced >= 1 && forced <= 65535) {
    chosen = forced;
    console.log(`[index] FORCE_BACKEND_PORT applied: ${chosen}`);
  }
  // Reflect chosen port into env and app locals for downstream reads (status, etc.)
  try { process.env.PORT = String(chosen); } catch (_) {}
  app.locals.port = chosen;

  server = app.listen(chosen, async () => {
    console.log(`🚀 Server is running on http://localhost:${chosen}`);
  // Preload general settings into cache on startup
  try {
    const settingsCache = require('./lib/settingsCache');
    await settingsCache.refreshAll();
    console.log('[index] preloaded general settings');
  } catch (e) {
    console.warn('[index] failed to preload general settings:', e && e.message ? e.message : e);
  }
  // Start session cleanup scheduler
  try {
    const sessionCleanup = require('./lib/sessionCleanup');
    sessionCleanup.startSessionCleanup();
    console.log('[index] session cleanup scheduler started');
  } catch (e) {
    console.warn('[index] failed to start session cleanup scheduler:', e && e.message ? e.message : e);
  }
  // Start telegram bot alongside the backend unless explicitly disabled or running tests
  if (process.env.START_TELEGRAM_BOT !== 'false' && process.env.NODE_ENV !== 'test') {
    try {
      const bot = require('./telegram_bot');
      if (bot && typeof bot.startTelegramBot === 'function') {
        bot.startTelegramBot().catch(err => console.error('[index] failed to start telegram bot:', err && err.message ? err.message : err));
        console.log('[index] Telegram bot start requested');
      } else {
        console.warn('[index] telegram_bot module does not expose startTelegramBot(); requiring module only');
        require('./telegram_bot');
      }
    } catch (e) {
      console.error('[index] Failed to start Telegram bot:', e && e.message ? e.message : e);
    }
  } else {
    console.log('[index] Telegram bot not started (START_TELEGRAM_BOT=false or NODE_ENV=test)');
  }
  });

}

// Graceful shutdown: stop bot and close HTTP server
async function shutdown(code = 0) {
  console.log('[index] shutting down');
  // Stop session cleanup scheduler
  try {
    const sessionCleanup = require('./lib/sessionCleanup');
    sessionCleanup.stopSessionCleanup();
    console.log('[index] session cleanup scheduler stopped');
  } catch (e) {
    console.warn('[index] error stopping session cleanup:', e && e.message ? e.message : e);
  }
  try {
    const bot = require.cache[require.resolve('./telegram_bot')];
    if (bot) {
      try {
        const mod = require('./telegram_bot');
        if (mod && typeof mod.stopTelegramBot === 'function') {
          await mod.stopTelegramBot();
          console.log('[index] telegram bot stopped');
        }
      } catch (e) {
        console.warn('[index] error stopping telegram bot:', e && e.message ? e.message : e);
      }
    }
  } catch (e) {
    // ignore
  }
  try {
    if (server && typeof server.close === 'function') {
      server.close(() => {
        console.log('[index] http server closed');
        process.exit(code);
      });
      // force exit after timeout
      setTimeout(() => process.exit(code), 5000);
      return;
    }
  } catch (e) {
    console.error('[index] error during shutdown:', e && e.message ? e.message : e);
    process.exit(code);
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Kick off start
start().catch(err => {
  console.error('[index] fatal: failed to start server:', err && err.message ? err.message : err);
  process.exit(1);
});

