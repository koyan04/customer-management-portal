const { Client } = require('pg');
(async ()=>{
  const c = new Client({ host:process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'koyan', database: process.env.DB_DATABASE || 'user_management_portal' });
  try {
    await c.connect();
    const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='admins' ORDER BY ordinal_position");
    console.log('admins columns:', r.rows.map(r=>r.column_name));
    await c.end();
    process.exit(0);
  } catch (e) { console.error('ERR', e); process.exit(2); }
})();