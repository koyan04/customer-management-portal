const { Client } = require('pg');
(async ()=>{
  const c = new Client({ host:process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 5432, user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'koyan', database: process.env.DB_DATABASE || 'user_management_portal' });
  try {
    await c.connect();
    // Add column if it doesn't exist
    await c.query("ALTER TABLE admins ADD COLUMN IF NOT EXISTS avatar_data TEXT");
    console.log('Ensured avatar_data column exists');
    await c.end();
    process.exit(0);
  } catch (e) { console.error('ERR', e); process.exit(2); }
})();