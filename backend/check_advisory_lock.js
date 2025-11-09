require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');
(async function(){
  try {
    const r = await pool.query('SELECT pg_try_advisory_lock($1) AS ok', [1234567890]);
    console.log('pg_try_advisory_lock result:', r.rows && r.rows[0] ? r.rows[0].ok : null);
    // if we acquired it, release it
    if (r.rows && r.rows[0] && r.rows[0].ok) {
      await pool.query('SELECT pg_advisory_unlock($1)', [1234567890]);
      console.log('Released lock we acquired');
    }
    await pool.end();
  } catch (e) {
    console.error('ERROR checking lock:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
