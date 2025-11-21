#!/usr/bin/env node
// load dotenv so this script can be run standalone and pick up backend/.env
try { require('dotenv').config(); } catch (e) { /* ignore if not installed */ }
const db = require('../db');
// ensure_avatar_column: add avatar_url TEXT to admins if it's missing
(async () => {
  try {
    const res = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='admins' AND column_name='avatar_url'");
    if (res.rows.length === 0) {
      console.log('avatar_url column missing, adding it...');
      await db.query('ALTER TABLE admins ADD COLUMN avatar_url TEXT');
      console.log('avatar_url column added.');
    } else {
      console.log('avatar_url column already exists.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Error ensuring avatar_url column:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
