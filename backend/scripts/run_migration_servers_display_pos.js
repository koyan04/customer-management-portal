require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async function(){
  try {
    const file = path.join(__dirname, '..', 'migrations', '2025-11-06-add-servers-display-pos.sql');
    if (!fs.existsSync(file)) {
      console.error('Migration file not found:', file);
      process.exit(1);
    }
    const sql = fs.readFileSync(file, 'utf8');
    console.log('Applying migration:', path.basename(file));
    await pool.query(sql);
    console.log('Migration applied successfully');
    process.exit(0);
  } catch (e) {
    console.error('Failed to apply migration:', e && e.message ? e.message : e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
