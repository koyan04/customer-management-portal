#!/usr/bin/env node
// Backfill script to add price_*_cents into settings_audit.after_data for 'general' entries.
// Usage: node backfill_pricing_audit.js [--dry-run] [--batch=100]

const pool = require('../db');

async function main(opts) {
  const argv = opts && typeof opts === 'object' ? opts : require('minimist')(process.argv.slice(2));
  const dry = !!argv['dry-run'] || !!argv.dry || !!argv.dryRun || !!argv.dryRun;
  const batch = Number(argv.batch) || 100;
  console.log(`Backfill pricing audit: dry=${dry} batch=${batch}`);

  const client = await pool.connect();
  try {
    const totalRes = await client.query("SELECT COUNT(*)::int AS c FROM settings_audit WHERE settings_key = 'general'");
    const total = totalRes.rows && totalRes.rows[0] ? totalRes.rows[0].c : 0;
    console.log('Found', total, "audit rows for 'general'");

    let offset = 0;
    while (offset < total) {
      const res = await client.query("SELECT id, after_data FROM settings_audit WHERE settings_key = 'general' ORDER BY id LIMIT $1 OFFSET $2", [batch, offset]);
      if (!res.rows || res.rows.length === 0) break;
      for (const row of res.rows) {
        const id = row.id;
        const d = row.after_data || {};
        // skip if already has cents
        if (Object.prototype.hasOwnProperty.call(d, 'price_mini_cents') || Object.prototype.hasOwnProperty.call(d, 'price_basic_cents') || Object.prototype.hasOwnProperty.call(d, 'price_unlimited_cents')) {
          continue;
        }
        // compute values (favor price_backup_decimal if present)
        const pb = (d && d.price_backup_decimal) || null;
        const getDec = (k) => {
          if (pb && pb[k] != null) return Number(pb[k]);
          if (d && d[k] != null) return Number(d[k]);
          return 0;
        };
        const pm = Math.round((getDec('price_mini') || 0) * 100);
        const pbasic = Math.round((getDec('price_basic') || 0) * 100);
        const pu = Math.round((getDec('price_unlimited') || 0) * 100);

        const next = Object.assign({}, d, { price_mini_cents: pm, price_basic_cents: pbasic, price_unlimited_cents: pu });
        if (dry) {
          console.log('[DRY] Would update id=', id, ' ->', { price_mini_cents: pm, price_basic_cents: pbasic, price_unlimited_cents: pu });
        } else {
          await client.query('UPDATE settings_audit SET after_data = $1 WHERE id = $2', [next, id]);
          console.log('Updated id=', id);
        }
      }
      offset += res.rows.length;
    }
    console.log('Done');
  } catch (e) {
    console.error('Backfill failed:', e && e.stack ? e.stack : e);
  } finally {
    try { client.release(); } catch (_) {}
    try { await pool.end(); } catch (_) {}
  }
}

module.exports = { main };

if (require.main === module) {
  // When executed from CLI, parse argv normally and run
  main();
}
