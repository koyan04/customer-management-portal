require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

(async () => {
  try {
    console.log('--- SERVERS table columns ---');
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='servers' ORDER BY ordinal_position");
    console.log(JSON.stringify(cols.rows, null, 2));

    console.log('\n--- SERVERS sample ordered by display_pos ---');
    const q = `SELECT id, server_name, owner, service_type, ip_address, domain_name, display_pos, created_at FROM servers ORDER BY COALESCE(display_pos, 2147483647) ASC, created_at DESC LIMIT 200`;
    const res = await pool.query(q);
    console.log(JSON.stringify(res.rows, null, 2));
    console.log(`\nTotal returned: ${res.rows.length}`);
  } catch (e) {
    console.error('ERROR fetching servers:', e && e.message ? e.message : e);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
