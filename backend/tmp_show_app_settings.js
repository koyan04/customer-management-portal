require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');
(async ()=>{
  try{
    const { rows } = await pool.query("SELECT settings_key, data, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at FROM app_settings ORDER BY settings_key");
    console.log(JSON.stringify(rows || [], null, 2));
  } catch(e) {
    console.error('Error querying DB:', e && e.message ? e.message : e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch(_) {}
  }
})();
