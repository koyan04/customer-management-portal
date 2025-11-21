require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runFiles(files) {
  try {
    for (const f of files) {
      const p = path.join(__dirname, f);
      if (!fs.existsSync(p)) {
        console.warn('Migration file not found, skipping:', p);
        continue;
      }
      const sql = fs.readFileSync(p, 'utf8');
      console.log('Running migration file:', p);
      await pool.query(sql);
    }
    console.log('Selected migrations applied successfully');
  } catch (err) {
    console.error('Error applying selected migrations:', err && err.message ? err.message : err);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  // run the pricing defaults and cents migration in order
  runFiles(['migrations/2025-10-23-add-pricing-defaults.sql', 'migrations/2025-10-24-pricing-to-cents.sql']);
}

module.exports = runFiles;
