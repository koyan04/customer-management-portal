require('dotenv').config();
const pool = require('./db');
(async () => {
  try {
    const a = await pool.query("SELECT id, admin_id, target_account_id, note, created_at FROM password_reset_audit ORDER BY created_at DESC LIMIT 50");
    console.log('---PASSWORD_RESET_AUDIT---');
    console.log(JSON.stringify(a.rows, null, 2));
    // Also check login_audit for recent login attempts (including failed ones)
    try {
      const lacols = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='login_audit'");
      console.log('---LOGIN_AUDIT_COLUMNS---');
      console.log(JSON.stringify(lacols.rows, null, 2));
      // Try a permissive select of common columns
      const la = await pool.query("SELECT * FROM login_audit ORDER BY created_at DESC LIMIT 100");
      console.log('---LOGIN_AUDIT_ROWS---');
      console.log(JSON.stringify(la.rows, null, 2));
    } catch (e) {
      console.log('---LOGIN_AUDIT---');
      console.log('table missing or query failed:', e && e.message ? e.message : e);
    }
    const cols = await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='admins'");
    console.log('---ADMINS_COLUMNS---');
    console.log(JSON.stringify(cols.rows, null, 2));

    // Try selecting admins with possible timestamp columns
    const candidates = ['updated_at','last_modified','modified_at','created_at','created','updated'];
    let adminsRes = null;
    for (const c of candidates) {
      try {
        const q = `SELECT id, username, display_name, role, ${c} as ts FROM admins ORDER BY ${c} DESC LIMIT 50`;
        const r = await pool.query(q);
        adminsRes = { tsColumn: c, rows: r.rows };
        break;
      } catch (err) {
        // ignore
      }
    }

    if (adminsRes) {
      console.log('---ADMINS_RECENT_UPDATES---');
      console.log(JSON.stringify(adminsRes, null, 2));
    } else {
      const r = await pool.query('SELECT id, username, display_name, role FROM admins LIMIT 50');
      console.log('---ADMINS_FALLBACK---');
      console.log(JSON.stringify(r.rows, null, 2));
    }

    // list recent settings_audit entries (useful for config changes)
    try {
      const sa = await pool.query("SELECT id, admin_id, settings_key, action, created_at FROM settings_audit ORDER BY created_at DESC LIMIT 50");
      console.log('---SETTINGS_AUDIT_RECENT---');
      console.log(JSON.stringify(sa.rows, null, 2));
    } catch (e) {
      console.log('---SETTINGS_AUDIT_RECENT---');
      console.log('table missing or query failed:', e && e.message ? e.message : e);
    }
  } catch (e) {
    console.error('QUERY_ERROR', e && e.message ? e.message : e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
