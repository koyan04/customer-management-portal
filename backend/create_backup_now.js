#!/usr/bin/env node
/**
 * Create a complete backup with all fields (contact, keys, etc.)
 * Usage: node create_backup_now.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function createBackup() {
  try {
    console.log('Creating complete backup...');
    
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(__dirname, `../cmp-backup-${now}.json`);
    
    // Fetch all data with complete fields
    const [settingsRes, serversRes, serverKeysRes, usersRes] = await Promise.all([
      pool.query('SELECT * FROM app_settings'),
      pool.query('SELECT id, server_name, ip_address, domain_name, owner, created_at FROM servers'),
      pool.query('SELECT id, server_id, username, description, original_key, generated_key, created_at FROM server_keys'),
      pool.query('SELECT id, server_id, account_name, service_type, contact, expire_date, total_devices, data_limit_gb, remark, display_pos, created_at FROM users')
    ]);
    
    const payload = {
      created_at: new Date().toISOString(),
      app_settings: settingsRes.rows || [],
      servers: serversRes.rows || [],
      server_keys: serverKeysRes.rows || [],
      users: usersRes.rows || []
    };
    
    await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
    
    console.log(`✅ Backup created successfully!`);
    console.log(`📁 File: ${outPath}`);
    console.log(`📊 Stats:`);
    console.log(`   - Settings: ${payload.app_settings.length}`);
    console.log(`   - Servers: ${payload.servers.length}`);
    console.log(`   - Keys: ${payload.server_keys.length}`);
    console.log(`   - Users: ${payload.users.length}`);
    
    // Show sample to verify fields
    if (payload.users.length > 0) {
      const sample = payload.users[0];
      console.log(`\n📋 Sample user fields:`, Object.keys(sample).join(', '));
    }
    if (payload.server_keys.length > 0) {
      const sample = payload.server_keys[0];
      console.log(`🔑 Sample key fields:`, Object.keys(sample).join(', '));
    }
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error creating backup:', err);
    await pool.end();
    process.exit(1);
  }
}

createBackup();
