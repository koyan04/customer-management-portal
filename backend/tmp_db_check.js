require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');

(async () => {
  try {
    const { rows } = await pool.query('SELECT id, server_id, username, description, original_key, generated_key, created_at FROM server_keys ORDER BY id DESC');
    console.log('server_keys rows:');
    console.log(rows);
    process.exit(0);
  } catch (e) {
    console.error('DB error', e);
    process.exit(2);
  }
})();
