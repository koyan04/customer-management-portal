require('dotenv').config({ path: './backend/.env' });
const pool = require('../backend/db');
(async () => {
  try {
    const r = await pool.query('SELECT id, username, role FROM admins WHERE id = $1', [10]);
    console.log('DB admins row for id=10:', JSON.stringify(r.rows));
    await pool.end();
  } catch (e) {
    console.error('DB query failed:', e);
    process.exit(1);
  }
})();
