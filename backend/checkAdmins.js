require('dotenv').config();
const pool = require('./db');

async function checkAdmins() {
  try {
    const result = await pool.query('SELECT id, username, display_name, role, created_at FROM admins ORDER BY id');
    console.log('\n=== Admin Accounts ===\n');
    if (result.rows.length === 0) {
      console.log('NO ADMIN ACCOUNTS FOUND!');
      console.log('\nYou need to run: node seedAdmin.js');
    } else {
      console.log(`Found ${result.rows.length} admin account(s):\n`);
      result.rows.forEach(admin => {
        console.log(`ID: ${admin.id}`);
        console.log(`Username: ${admin.username}`);
        console.log(`Display Name: ${admin.display_name}`);
        console.log(`Role: ${admin.role}`);
        console.log(`Created: ${admin.created_at}`);
        console.log('---');
      });
    }
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkAdmins();
