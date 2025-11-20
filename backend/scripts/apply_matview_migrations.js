#!/usr/bin/env node
// Apply (or re-apply) user_status_matview migrations in correct order.
// This ensures the materialized view exists with the expected cutoff semantics
// and a UNIQUE index on id so CONCURRENT refresh is possible.
// Usage (Windows PowerShell):
//   node backend/scripts/apply_matview_migrations.js
// Requirements: DB connection env vars (DB_HOST, DB_USER, DB_PASS, DB_NAME, etc.)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

// Ordered list: latest definition first (drops/creates), then unique index.
const files = [
  '2025-11-06-update-user-status-matview-cutoff.sql',
  '2025-10-30-add-matview-unique-idx.sql'
];

(async function run() {
  try {
    for (const f of files) {
      const full = path.join(__dirname, '..', 'migrations', f);
      if (!fs.existsSync(full)) {
        console.warn('[matview] migration file missing, skipping:', f);
        continue;
      }
      const sql = fs.readFileSync(full, 'utf8');
      console.log('[matview] applying', f);
      await pool.query(sql);
      console.log('[matview] applied', f);
    }
    console.log('[matview] all applicable migrations applied');
    process.exit(0);
  } catch (e) {
    console.error('[matview] migration apply failed:', e && e.stack ? e.stack : e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
