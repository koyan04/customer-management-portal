(async ()=>{
  try {
    const db = require('../db');
    const res = await db.query("SELECT COUNT(*)::int AS n_total FROM settings_audit WHERE settings_key='general'");
    const res2 = await db.query("SELECT COUNT(*)::int AS n_cents FROM settings_audit WHERE settings_key='general' AND (after_data ? 'price_mini_cents')");
    console.log('total_general=' + res.rows[0].n_total);
    console.log('with_price_mini_cents=' + res2.rows[0].n_cents);
    process.exit(0);
  } catch (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  }
})();
