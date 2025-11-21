const { Pool } = require('pg');
require('dotenv').config();

async function check() {
  const pool = new Pool();
  try {
    const res1 = await pool.query("SELECT to_regclass('public.admins') AS admins_table");
  const res2 = await pool.query("SELECT to_regclass('public.viewer_server_permissions') AS perms_table");

  console.log('admins table:', res1.rows[0].admins_table);
  console.log('viewer_server_permissions table:', res2.rows[0].perms_table);

  if (!res1.rows[0].admins_table || !res2.rows[0].perms_table) {
      console.error('One or more migration tables are missing.');
      process.exitCode = 2;
    } else {
      console.log('All required migration tables exist.');
    }
  } catch (err) {
    console.error('Error checking migrations:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) check();
