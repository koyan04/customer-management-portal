#!/usr/bin/env node
// One-off: set process.env to the same DB the backend was started with (cmpdb on 5433)
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5433';
process.env.DB_USER = process.env.DB_USER || 'cmpuser';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'pass123';
process.env.DB_DATABASE = process.env.DB_DATABASE || 'cmpdb';
try { require('dotenv').config(); } catch (e) { /* ignore */ }
const db = require('../db');
(async () => {
  try {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='admins' AND column_name='avatar_url'");
    if (res.rows.length === 0) {
      console.log('avatar_url column missing in cmpdb, adding it...');
      await db.query('ALTER TABLE admins ADD COLUMN avatar_url TEXT');
      console.log('avatar_url column added in cmpdb.');
    } else {
      console.log('avatar_url column already exists in cmpdb.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Error ensuring avatar_url column in cmpdb:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
