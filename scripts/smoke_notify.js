// Intentionally not loading dotenv here so the caller can provide DB env vars on the command line
const tg = require('../backend/telegram_bot');

(async () => {
  const info = { adminId: 1, role: 'admin', username: 'admin', ip: '127.0.0.1', userAgent: 'smoke-test' };
  console.log('Calling notifyLoginEvent with:', info);
  try {
    await tg.notifyLoginEvent(info);
    console.log('notifyLoginEvent resolved');
    process.exit(0);
  } catch (e) {
    console.error('notifyLoginEvent threw:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
