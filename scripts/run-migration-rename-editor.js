// Simple migration runner to convert 'EDITOR' -> 'VIEWER' using the project's database pool
// Usage: from project root: node scripts/run-migration-rename-editor.js

const path = require('path');
const fs = require('fs');
const pool = require('../backend/db');

(async () => {
  try {
    const sqlPath = path.join(__dirname, '..', 'backend', 'migrations', '2025-10-13-rename-editor-to-viewer.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log('Running migration:', sqlPath);
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
})();
