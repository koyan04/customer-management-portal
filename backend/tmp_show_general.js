require('dotenv').config();
const pool = require('./db');
(async ()=>{
  try{
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    console.log('app_settings.general:');
    console.log(JSON.stringify(rows[0] ? rows[0].data : {}, null, 2));
  } catch(e) {
    console.error('Error querying DB:', e && e.message ? e.message : e);
  } finally {
    await pool.end();
  }
})();
