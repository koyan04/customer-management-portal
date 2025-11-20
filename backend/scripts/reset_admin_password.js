require('dotenv').config();
const pool = require('../db');
const bcrypt = require('bcrypt');

async function reset(user, pass) {
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(pass, salt);
    const r = await pool.query('UPDATE admins SET password_hash = $1 WHERE username = $2 RETURNING id, username', [hash, user]);
    console.log('updated', r.rows);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('reset failed', err && err.message ? err.message : err);
    try { await pool.end(); } catch(e){}
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const user = args[0] || 'admin';
const pass = args[1] || 'admin123';
reset(user, pass);
