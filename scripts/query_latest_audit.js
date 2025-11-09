// Intentionally not loading dotenv here so the caller can provide DB env vars on the command line
const pool = require('../backend/db');

(async () => {
  try {
    const r = await pool.query('SELECT id, chat_id, admin_id, role, username, status, error, payload, created_at FROM telegram_login_notify_audit ORDER BY created_at DESC LIMIT 5');
    console.log('Latest telegram_login_notify_audit rows:');
    console.log(JSON.stringify(r.rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Query failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
