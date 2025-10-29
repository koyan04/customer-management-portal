const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

(async () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE || 'user_management_portal',
  });

  try {
    const sqlFile = path.join(__dirname, 'migrations', '2025-10-29-add-admins-audit.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');
    console.log('Running migration SQL...');
    await pool.query(sql);
    console.log('Migration applied.');

    // Hash the new password
    const newPassword = 'koyan04';
    const saltRounds = 10;
    const hash = await bcrypt.hash(newPassword, saltRounds);

    // Set session variable so trigger records changed_by (we set it to 1 = admin)
    await pool.query("SET app.current_admin_id = '1';");

    // Update admin id=1 password_hash and updated_at
    console.log('Updating admin id=1 password_hash...');
    await pool.query('UPDATE admins SET password_hash = $1 WHERE id = 1;', [hash]);

    // fetch and print the updated admin row and last audit rows for admin id 1
    const adminRes = await pool.query('SELECT id, username, display_name, role, created_at, updated_at, password_hash FROM admins WHERE id = 1;');
    console.log('---UPDATED_ADMIN_ROW---');
    console.log(JSON.stringify(adminRes.rows, null, 2));

    const auditRes = await pool.query('SELECT * FROM admins_audit WHERE admin_id = 1 ORDER BY created_at DESC LIMIT 5;');
    console.log('---ADMINS_AUDIT_RECENT---');
    console.log(JSON.stringify(auditRes.rows, null, 2));

    console.log('\nPassword rotated locally. Plaintext password: "' + newPassword + '"');
  } catch (err) {
    console.error('ERROR', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
