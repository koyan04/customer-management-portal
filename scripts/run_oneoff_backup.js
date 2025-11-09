// Run a one-off backup/report via the Telegram bot module (does not start poll loop)
const tg = require('../backend/telegram_bot');

(async () => {
  try {
    console.log('Triggering one-off backup...');
    await tg.doOneOffBackup();
    console.log('One-off backup completed');
    process.exit(0);
  } catch (e) {
    console.error('One-off backup failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
