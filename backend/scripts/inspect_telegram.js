require('dotenv').config();
const pool = require('../db');
(async function(){
  try{
    const r = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'telegram'");
    if (!r.rows || r.rows.length === 0) {
      console.log('No telegram settings row found');
      process.exit(0);
    }
    console.log('app_settings.telegram:');
    console.log(JSON.stringify(r.rows[0].data, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Failed to query DB:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
