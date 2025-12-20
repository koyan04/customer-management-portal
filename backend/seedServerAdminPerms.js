require('dotenv').config();
const pool = require('./db');

async function seed() {
  try {
    console.log('Setting up server admin permissions...');
    
    // Get Yu Yu's admin ID (should be 2)
    const yuyu = await pool.query("SELECT id FROM admins WHERE username = 'yuyu'");
    // Get VChannel's admin ID  
    const vchannel = await pool.query("SELECT id FROM admins WHERE username = 'vchannel'");
    
    if (yuyu.rows.length === 0) {
      console.log('Yu Yu user not found - skipping');
    } else {
      const yuyuId = yuyu.rows[0].id;
      console.log(`Found Yu Yu with id=${yuyuId}`);
      
      // Get first server
      const servers = await pool.query('SELECT id FROM servers ORDER BY id LIMIT 2');
      if (servers.rows.length > 0) {
        // Assign first server to Yu Yu
        await pool.query(
          'INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [yuyuId, servers.rows[0].id]
        );
        console.log(`Assigned server ${servers.rows[0].id} to Yu Yu`);
      }
    }
    
    if (vchannel.rows.length === 0) {
      console.log('VChannel user not found - skipping');
    } else {
      const vchannelId = vchannel.rows[0].id;
      console.log(`Found VChannel with id=${vchannelId}`);
      
      // Get second server
      const servers = await pool.query('SELECT id FROM servers ORDER BY id LIMIT 2');
      if (servers.rows.length > 1) {
        // Assign second server to VChannel
        await pool.query(
          'INSERT INTO server_admin_permissions (admin_id, server_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [vchannelId, servers.rows[1].id]
        );
        console.log(`Assigned server ${servers.rows[1].id} to VChannel`);
      }
    }
    
    // Show current permissions
    const perms = await pool.query('SELECT admin_id, server_id FROM server_admin_permissions ORDER BY admin_id, server_id');
    console.log('\nCurrent server admin permissions:');
    console.table(perms.rows);
    
    console.log('\nDone!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed server admin permissions:', err.message || err);
    process.exit(1);
  }
}

seed();
