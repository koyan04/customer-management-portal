require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

(async () => {
  try {
    const res = await pool.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename;");
    if (!res || !res.rows) {
      console.log('No tables returned.');
      process.exit(0);
    }
    console.log('Tables in public schema:');
    res.rows.forEach(r => console.log('- ' + r.tablename));
  } catch (e) {
    console.error('Error querying database:', (e && e.message) || e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch(_) {}
  }
})();