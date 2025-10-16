const fs = require('fs');
const path = require('path');
require('dotenv').config();
const pool = require('./db');

async function run() {
  const file = path.join(__dirname, 'migrations.sql');
  if (!fs.existsSync(file)) {
    console.error('migrations.sql not found at', file);
    process.exit(1);
  }

  const sql = fs.readFileSync(file, 'utf8');
  try {
    console.log('Running migrations...');
    // execute the whole file contents; pg supports multi-statement queries
    await pool.query(sql);
    console.log('Migrations applied successfully');
  } catch (err) {
    console.error('Error applying migrations:', err.message || err);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (require.main === module) run();
module.exports = run;
