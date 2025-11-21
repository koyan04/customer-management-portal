(async () => {
  try {
    const db = require('../db');
    const res = await db.query(
      `SELECT id, created_at, after_data
       FROM settings_audit
       WHERE settings_key = 'general'
       ORDER BY created_at DESC
       LIMIT 10`
    );

    console.log('Sample of settings_audit (general) rows:');
    for (const r of res.rows) {
      const ad = r.after_data || {};
      console.log('---');
      console.log('id:', r.id);
      console.log('created_at:', r.created_at);
      console.log('price_mini_cents:', ad.price_mini_cents);
      console.log('price_basic_cents:', ad.price_basic_cents);
      console.log('price_unlimited_cents:', ad.price_unlimited_cents);
      if (ad.price_backup_decimal) console.log('price_backup_decimal:', ad.price_backup_decimal);
    }
    process.exit(0);
  } catch (e) {
    console.error('Error sampling rows:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
