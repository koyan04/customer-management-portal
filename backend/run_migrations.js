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
    // Bootstrap critical tables defensively to avoid "relation users does not exist" when indexes run early
    console.log('Running migrations...');
    try {
      // admins
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id SERIAL PRIMARY KEY,
          display_name TEXT NOT NULL,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          avatar_url TEXT,
          avatar_data TEXT,
          role TEXT NOT NULL DEFAULT 'VIEWER',
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      // servers
      await pool.query(`
        CREATE TABLE IF NOT EXISTS servers (
          id SERIAL PRIMARY KEY,
          server_name TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      // users (minimal schema to satisfy downstream statements; full schema in migrations.sql will reconcile)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          server_id INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          account_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
    } catch (e) {
      // Continue even if bootstrap fails; subsequent migration may still succeed
      console.warn('[migrate] bootstrap pre-check failed (continuing):', e && e.message ? e.message : e);
    }

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
