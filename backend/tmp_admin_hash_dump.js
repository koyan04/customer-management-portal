const { Pool } = require('pg');
(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'user_management_portal',
  });
  try {
    const res = await pool.query("SELECT id, username, display_name, role, created_at, password_hash FROM admins ORDER BY id;");
    console.log('---ADMINS_WITH_HASHES---');
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.error('ERROR', err);
  } finally {
    await pool.end();
  }
})();
