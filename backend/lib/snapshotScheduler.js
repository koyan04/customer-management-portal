/**
 * Automatic Monthly Financial Snapshot Scheduler
 *
 * Runs at 01:00 on the 1st of every month and generates a permanent
 * financial snapshot for the previous (just-completed) month.
 *
 * Snapshots are immutable once created: if one already exists for a month
 * it is left untouched (ON CONFLICT DO NOTHING logic).
 */

const cron = require('node-cron');
const pool = require('../db');

let scheduledTask = null;

/** 
 * Core snapshot logic — same calculation as POST /financial/snapshot.
 * Always generates the GLOBAL admin snapshot (server_id = NULL).
 * Per-server SERVER_ADMIN snapshots are still generated manually via the UI.
 */
async function generateMonthlySnapshot(targetMonth) {
  const monthStart = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);
  const monthEnd   = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);

  // Check if already exists (snapshots are permanent)
  const existing = await pool.query(
    'SELECT id FROM monthly_financial_snapshots WHERE month_start = $1 AND server_id IS NULL',
    [monthStart]
  );
  if (existing.rows.length > 0) {
    console.log(`[snapshotScheduler] Snapshot for ${targetMonth.toISOString().slice(0,7)} already exists — skipping.`);
    return { skipped: true };
  }

  // Normalise service type
  const normaliseService = (svc) => {
    const v = (svc || '').toString().toLowerCase();
    if (v === 'x-ray' || v === 'xray' || v === 'outline' || v === 'mini') return 'Mini';
    if (v === 'basic') return 'Basic';
    if (v === 'unlimited') return 'Unlimited';
    return null;
  };

  // Count active users at end of month (global — all servers)
  const countResult = await pool.query(
    `SELECT service_type, COUNT(*)::int AS cnt
     FROM users
     WHERE created_at <= $1
       AND (expire_date IS NULL OR expire_date >= $2)
       AND enabled = TRUE
     GROUP BY service_type`,
    [monthEnd, monthStart]
  );

  const counts = { Mini: 0, Basic: 0, Unlimited: 0 };
  for (const row of countResult.rows) {
    const svc = normaliseService(row.service_type);
    if (svc) counts[svc] += Number(row.cnt || 0);
  }

  // Prices from settings_audit at end of month
  const pricesResult = await pool.query(
    `SELECT after_data FROM settings_audit
     WHERE settings_key = 'general' AND created_at <= $1
     ORDER BY created_at DESC LIMIT 1`,
    [monthEnd]
  );

  const safeNum = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  let prices = { price_mini_cents: 0, price_basic_cents: 0, price_unlimited_cents: 0 };

  if (pricesResult.rows.length > 0) {
    const d = pricesResult.rows[0].after_data || {};
    prices.price_mini_cents     = safeNum(d.price_mini_cents     || (d.price_backup_decimal?.price_mini     ? Math.round(Number(d.price_backup_decimal.price_mini)     * 100) : 0));
    prices.price_basic_cents    = safeNum(d.price_basic_cents    || (d.price_backup_decimal?.price_basic    ? Math.round(Number(d.price_backup_decimal.price_basic)    * 100) : 0));
    prices.price_unlimited_cents= safeNum(d.price_unlimited_cents|| (d.price_backup_decimal?.price_unlimited? Math.round(Number(d.price_backup_decimal.price_unlimited)* 100) : 0));
  }

  // Fall back to current settings if audit has no entry
  if (prices.price_mini_cents === 0 && prices.price_basic_cents === 0 && prices.price_unlimited_cents === 0) {
    const cur = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    if (cur.rows.length > 0) {
      const d = cur.rows[0].data || {};
      prices.price_mini_cents     = safeNum(d.price_mini_cents     || (d.price_backup_decimal?.price_mini     ? Math.round(Number(d.price_backup_decimal.price_mini)     * 100) : 0));
      prices.price_basic_cents    = safeNum(d.price_basic_cents    || (d.price_backup_decimal?.price_basic    ? Math.round(Number(d.price_backup_decimal.price_basic)    * 100) : 0));
      prices.price_unlimited_cents= safeNum(d.price_unlimited_cents|| (d.price_backup_decimal?.price_unlimited? Math.round(Number(d.price_backup_decimal.price_unlimited)* 100) : 0));
    }
  }

  const revenue_cents =
    counts.Mini       * prices.price_mini_cents +
    counts.Basic      * prices.price_basic_cents +
    counts.Unlimited  * prices.price_unlimited_cents;

  const result = await pool.query(
    `INSERT INTO monthly_financial_snapshots
       (month_start, month_end, mini_count, basic_count, unlimited_count,
        price_mini_cents, price_basic_cents, price_unlimited_cents,
        revenue_cents, server_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,'auto-generated')
     ON CONFLICT (month_start, COALESCE(server_id, 0)) DO NOTHING
     RETURNING id`,
    [
      monthStart, monthEnd,
      counts.Mini, counts.Basic, counts.Unlimited,
      prices.price_mini_cents, prices.price_basic_cents, prices.price_unlimited_cents,
      revenue_cents
    ]
  );

  if (result.rows.length === 0) {
    // Conflict — already existed (race condition)
    console.log(`[snapshotScheduler] Snapshot for ${targetMonth.toISOString().slice(0,7)} already exists (race) — skipping.`);
    return { skipped: true };
  }

  console.log(`[snapshotScheduler] Auto-generated snapshot for ${targetMonth.toISOString().slice(0,7)}: Mini=${counts.Mini}, Basic=${counts.Basic}, Unlimited=${counts.Unlimited}, revenue=${revenue_cents}`);
  return { created: true, counts, revenue_cents };
}

/**
 * Start the scheduler. Runs at 01:00 on the 1st of every month.
 * Generates a snapshot for the previous (just-completed) month.
 */
function startSnapshotScheduler() {
  if (scheduledTask) return; // already running

  // '0 1 1 * *' = minute 0, hour 1, day 1, every month
  scheduledTask = cron.schedule('0 1 1 * *', async () => {
    const now = new Date();
    // Previous month
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    console.log(`[snapshotScheduler] Running auto-snapshot for ${prevMonth.toISOString().slice(0, 7)}`);
    try {
      await generateMonthlySnapshot(prevMonth);
    } catch (err) {
      console.error('[snapshotScheduler] Auto-snapshot failed:', err && err.message ? err.message : err);
    }
  });

  console.log('[snapshotScheduler] Monthly auto-snapshot scheduler started (runs at 01:00 on 1st of each month)');
}

function stopSnapshotScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[snapshotScheduler] Monthly auto-snapshot scheduler stopped');
  }
}

module.exports = { startSnapshotScheduler, stopSnapshotScheduler, generateMonthlySnapshot };
