const pool = require('../backend/db');
(async () => {
  try {
    const r = await pool.query("SELECT count(*) AS cnt FROM viewer_server_permissions");
    console.log('viewer_server_permissions count:', r.rows[0].cnt);
    const c = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='viewer_server_permissions' ORDER BY ordinal_position");
    console.log('columns:', c.rows);
  } catch (e) {
    console.error('Error:', e && e.stack ? e.stack : e);
  } finally {
    await pool.end();
  }
})();
