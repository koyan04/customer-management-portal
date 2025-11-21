(async () => {
  try {
    const db = require('../db');

    console.log('Verifying backfill results...');

    const missingRes = await db.query(`
      SELECT COUNT(*)::int AS n_missing
      FROM settings_audit
      WHERE settings_key = 'general'
        AND NOT (after_data ? 'price_mini_cents')
        AND (after_data ? 'price_mini' OR after_data ? 'price_backup_decimal')
    `);

    console.log('Rows missing price_mini_cents but with legacy price keys:', missingRes.rows[0].n_missing);

    if (Number(missingRes.rows[0].n_missing) > 0) {
      const sample = await db.query(`
        SELECT id, created_at, after_data
        FROM settings_audit
        WHERE settings_key = 'general'
          AND NOT (after_data ? 'price_mini_cents')
          AND (after_data ? 'price_mini' OR after_data ? 'price_backup_decimal')
        ORDER BY created_at DESC
        LIMIT 20
      `);
      console.log('Sample rows missing cents (showing id, created_at, after_data keys):');
      for (const r of sample.rows) {
        console.log('---');
        console.log('id:', r.id, 'created_at:', r.created_at);
        console.log('after_data keys:', Object.keys(r.after_data || {}));
      }
    }

    // Find unusually large cents values (helpful to spot potential scale confusion)
    const largeRes = await db.query(`
      SELECT id, created_at, (after_data->>'price_mini_cents')::bigint AS mini_cents,
             (after_data->>'price_basic_cents')::bigint AS basic_cents
      FROM settings_audit
      WHERE settings_key = 'general'
        AND (after_data->>'price_mini_cents') IS NOT NULL
        AND ((after_data->>'price_mini_cents')::bigint > 100000 OR (after_data->>'price_basic_cents')::bigint > 100000)
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log('Rows with unusually large cents (>100000):', largeRes.rows.length);
    for (const r of largeRes.rows) {
      console.log('---');
      console.log('id:', r.id, 'created_at:', r.created_at, 'mini_cents:', r.mini_cents, 'basic_cents:', r.basic_cents);
    }

    console.log('Verification complete.');
    process.exit(0);
  } catch (e) {
    console.error('Verification error:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
