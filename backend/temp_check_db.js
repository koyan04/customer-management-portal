const pool = require('./db');
(async ()=>{
  try{
    const { rows } = await pool.query('SELECT id, display_name, username, role, avatar_url FROM admins WHERE id = $1', [3]);
    console.log(rows[0]);
    process.exit(0);
  } catch(e){ console.error(e); process.exit(1); }
})();
