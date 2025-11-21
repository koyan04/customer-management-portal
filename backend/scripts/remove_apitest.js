require('dotenv').config();
const pool = require('../db');

async function remove() {
  try {
    const res = await pool.query('DELETE FROM admins WHERE username = $1 RETURNING id, username', ['apitest']);
    if (res && res.rowCount > 0) {
      console.log('Removed apitest admin rows:', res.rows);
    } else {
      console.log('No apitest admin found');
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Failed to remove apitest:', err && err.message ? err.message : err);
    try { await pool.end(); } catch(e){}
    process.exit(1);
  }
}

remove();
