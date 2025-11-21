require('dotenv').config();
const fs = require('fs');
const pool = require('./db');
(async ()=>{
  try{
    const { rows } = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    const obj = rows[0] ? rows[0].data : {};
    fs.writeFileSync('backend/app_settings_general_backup.json', JSON.stringify(obj, null, 2));
    console.log('Wrote backend/app_settings_general_backup.json');
  } catch(e) {
    console.error('Backup failed:', e && e.message ? e.message : e);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
})();
