require('dotenv').config();
const pool = require('../db');
const bcrypt = require('bcrypt');

async function seed() {
  try {
    const username = 'test_server_admin';
    const password = 'password123';
    // check existing
    const ures = await pool.query('SELECT id, username FROM admins WHERE username = $1', [username]);
    let adminId;
    if (ures.rows && ures.rows.length > 0) {
      adminId = ures.rows[0].id;
      console.log('Admin already exists id=', adminId);
    } else {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      const r = await pool.query('INSERT INTO admins (display_name, username, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id', ['Test Server Admin', username, hash, 'SERVER_ADMIN']);
      adminId = r.rows[0].id;
      console.log('Created admin id=', adminId);
    }

    // ensure at least one server exists
    const sres = await pool.query('SELECT id FROM servers ORDER BY id LIMIT 1');
    let serverId;
    if (sres.rows && sres.rows.length > 0) {
      serverId = sres.rows[0].id;
      console.log('Found server id=', serverId);
    } else {
      const nr = await pool.query('INSERT INTO servers (server_name) VALUES ($1) RETURNING id', ['Seeded Test Server']);
      serverId = nr.rows[0].id;
      console.log('Inserted server id=', serverId);
    }

    // upsert into server_admin_permissions
    await pool.query('INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1,$2) ON CONFLICT (admin_id, server_id) DO NOTHING', [adminId, serverId]);
    console.log('Assigned admin', adminId, 'to server', serverId);

    console.log('Credentials: username=', username, ' password=', password, ' serverId=', serverId);
    process.exit(0);
  } catch (err) {
    console.error('Seeding test server admin failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

seed();
