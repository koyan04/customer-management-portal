require('dotenv').config();
const pool = require('./db');
(async ()=>{
  try{
    const { rows } = await pool.query("SELECT id, admin_id, settings_key, action, created_at, after_data FROM settings_audit WHERE settings_key = 'general' ORDER BY created_at DESC LIMIT 10");
    console.log('Recent settings_audit for general:');
    rows.forEach(r => {
      console.log('---');
      console.log(r.id, r.admin_id, r.action, r.created_at);
      try { console.log(JSON.stringify(r.after_data, null, 2)); } catch(e) { console.log(r.after_data); }
    });
  } catch(e) { console.error('Query failed:', e && e.message ? e.message : e); }
  finally { await pool.end(); }
})();
