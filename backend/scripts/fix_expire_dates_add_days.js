#!/usr/bin/env node
/*
One-time corrective script to adjust users.expire_date by a given number of days.

Usage (PowerShell):
  node .\backend\scripts\fix_expire_dates_add_days.js --days=1 --all --confirm

Safer targeted runs:
  # Preview (dry-run) only
  node .\backend\scripts\fix_expire_dates_add_days.js --days=1 --server=3 --since=2025-10-01 --until=2025-11-07

  # Execute with confirmation
  node .\backend\scripts\fix_expire_dates_add_days.js --days=1 --server=3 --since=2025-10-01 --until=2025-11-07 --confirm

Options:
  --days=N          Number of days to add (can be negative). Default: 1
  --server=ID       Limit to a specific server_id
  --since=YYYY-MM-DD  Only affect rows with expire_date >= since
  --until=YYYY-MM-DD  Only affect rows with expire_date <= until
  --all             Affect all rows (no server/since/until filter). Use with caution.
  --dry-run         Do not perform updates; show counts and sample rows. Default unless --confirm is provided.
  --confirm         Required to perform the UPDATE.

Environment:
  Reads DB connection from backend/.env or process environment via backend/db.js
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db');

function parseArgs(argv) {
  const args = { days: 1, dryRun: true, all: false, confirm: false };
  for (const a of argv.slice(2)) {
    const [k, v] = a.includes('=') ? a.split('=') : [a, null];
    switch (k) {
      case '--days': args.days = Number(v); break;
      case '--server': args.server = Number(v); break;
      case '--since': args.since = v; break;
      case '--until': args.until = v; break;
      case '--all': args.all = true; break;
      case '--dry-run': args.dryRun = true; break;
      case '--confirm': args.confirm = true; args.dryRun = false; break;
      case '-n': args.dryRun = true; break;
      default: break;
    }
  }
  if (!Number.isFinite(args.days)) throw new Error('--days must be a number');
  if (!args.all && !args.server && !args.since && !args.until) {
    console.warn('[SAFEGUARD] No filters provided. Use --all to target all rows, or pass --server/--since/--until. Running as dry-run.');
    args.dryRun = true;
  }
  return args;
}

function ymdValid(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

(async () => {
  const args = parseArgs(process.argv);
  const whereParts = [];
  const params = [];

  if (args.server) { params.push(args.server); whereParts.push(`server_id = $${params.length}`); }
  if (args.since) {
    if (!ymdValid(args.since)) { console.error('Invalid --since. Expect YYYY-MM-DD'); process.exit(2); }
    params.push(args.since);
    whereParts.push(`expire_date >= $${params.length}`);
  }
  if (args.until) {
    if (!ymdValid(args.until)) { console.error('Invalid --until. Expect YYYY-MM-DD'); process.exit(2); }
    params.push(args.until);
    whereParts.push(`expire_date <= $${params.length}`);
  }

  const whereSQL = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : (args.all ? '' : 'WHERE 1=0');
  const days = Math.trunc(args.days);

  try {
    // Count and preview a sample
    const countSql = `SELECT COUNT(*)::int AS cnt FROM users ${whereSQL}`;
    const c = await pool.query(countSql, params);
    const total = c.rows?.[0]?.cnt || 0;
    console.log(`[INFO] rows matching filter: ${total}`);

    const sampleSql = `SELECT id, account_name, expire_date AS old_date, (expire_date + $${params.length + 1}::int) AS new_date FROM users ${whereSQL} ORDER BY id ASC LIMIT 10`;
    const sample = await pool.query(sampleSql, [...params, days]);
    console.log('[SAMPLE before/after]');
    for (const r of sample.rows || []) {
      console.log(`  id=${r.id} ${r.account_name} : ${r.old_date} -> ${r.new_date}`);
    }

    if (args.dryRun || !args.confirm) {
      console.log('\n[DRY-RUN] No changes applied. Re-run with --confirm to apply updates.');
      process.exit(0);
    }

    // Perform update inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updSql = `UPDATE users SET expire_date = expire_date + $${params.length + 1}::int ${whereSQL}`;
      const upd = await client.query(updSql, [...params, days]);
      await client.query('COMMIT');
      console.log(`[DONE] Updated rows: ${upd.rowCount}`);
      process.exit(0);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[ERROR] Update failed:', e && e.message ? e.message : e);
      process.exit(2);
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('[ERROR] Failed:', e && e.message ? e.message : e);
    process.exit(2);
  } finally {
    try { await pool.end(); } catch (_) {}
  }
})();
