require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

(async () => {
  try {
    console.log('--- USERS table columns ---');
    const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position");
    console.log(JSON.stringify(cols.rows, null, 2));

    console.log('\n--- USERS sample (ordered like UI) ---');
    const q = `
      SELECT u.*,
             COALESCE(u.display_pos, ROW_NUMBER() OVER (PARTITION BY u.server_id ORDER BY u.created_at ASC)) AS effective_pos
      FROM users u
      ORDER BY u.server_id ASC, effective_pos ASC, u.created_at DESC
      LIMIT 100
    `;
    const res = await pool.query(q);
    // Print a trimmed view of the first rows for readability
    const rows = (res.rows || []).map(r => ({
      id: r.id,
      server_id: r.server_id,
      account_name: r.account_name,
      service_type: r.service_type,
      contact: r.contact,
      expire_date: r.expire_date,
      total_devices: r.total_devices,
      data_limit_gb: r.data_limit_gb,
      remark: r.remark,
      display_pos: r.display_pos,
      created_at: r.created_at,
      effective_pos: r.effective_pos
    }));
    console.log(JSON.stringify(rows, null, 2));
    console.log(`\nTotal returned: ${rows.length}`);
  } catch (e) {
    console.error('ERROR fetching users:', e && e.message ? e.message : e);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
