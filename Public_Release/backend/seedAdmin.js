require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcrypt');

async function seed() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const display_name = process.env.SEED_ADMIN_DISPLAY || 'Administrator';
  try {
    const { rows } = await pool.query('SELECT id FROM admins WHERE username = $1', [username]);
    if (rows.length > 0) {
      console.log('Admin user already exists');
      process.exit(0);
    }
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const res = await pool.query('INSERT INTO admins (display_name, username, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', [display_name, username, hash, 'ADMIN']);
    console.log('Admin created with id', res.rows[0].id);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

seed();
