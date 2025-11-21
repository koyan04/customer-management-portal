// Usage: node scripts/run-sql-migration.js backend/migrations/2025-10-13-allow-viewer-role.sql
const fs = require('fs');
const path = require('path');
const pool = require('../backend/db');

async function run(filePath) {
  try {
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log('Running SQL migration:', filePath);
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query('COMMIT');
    console.log('Migration applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err && err.message ? err.message : err);
    try { await pool.query('ROLLBACK'); } catch(e) { /* ignore */ }
    process.exit(1);
  }
}

if (process.argv.length < 3) {
  console.error('Usage: node scripts/run-sql-migration.js <path-to-sql-file>');
  process.exit(2);
}

const target = process.argv[2];
run(path.resolve(target));
