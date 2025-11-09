require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

(async () => {
  try {
    const r = await pool.query("SELECT to_regclass('public.user_status_matview') AS name");
    console.log('to_regclass:', r.rows && r.rows[0] ? r.rows[0].name : null);
    const mv = await pool.query("SELECT schemaname, matviewname FROM pg_matviews WHERE matviewname = 'user_status_matview'");
    console.log('pg_matviews rows:', mv.rows);
  } catch (e) {
    console.error('Error checking matview:', e && e.message ? e.message : e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch (_){ }
  }
})();
