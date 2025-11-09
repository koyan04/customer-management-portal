require('dotenv').config({ path: __dirname + '/.env' });
const pool = require('./db');
const escapeHtml = (s) => { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };

(async function(){
  try {
    const titleRow = await pool.query("SELECT data FROM app_settings WHERE settings_key = 'general'");
    let title = 'Customer Management Portal';
    if (titleRow.rows && titleRow.rows[0] && titleRow.rows[0].data) {
      const data = titleRow.rows[0].data;
      const candidates = [data.title, data.name, data.site_title, data.siteTitle, data.siteName, data.brand, data.header];
      for (const c of candidates) {
        if (c !== undefined && c !== null && String(c).trim() !== '') { title = String(c).trim(); break; }
      }
    }
    // Fallback to on-disk backup if DB has no title
    if (!title || title === 'Customer Management Portal') {
      try { const backup = require('./app_settings_general_backup.json'); if (backup && (backup.title || backup.name)) title = String(backup.title || backup.name).trim(); } catch(_) {}
    }
        // Add icon to match bot welcome styling
        const header = `<b>🌏 ${escapeHtml(title)} — Customer Management Portal</b>`;
    // reuse fetchDashboard from telegram_bot logic: inline simplified version
  const now = new Date();
    const { rows: serversRes } = await pool.query('SELECT id, server_name, ip_address, domain_name FROM servers ORDER BY created_at DESC');
    const serversRows = serversRes || [];
    let totalUsers = 0; let tiers = { Mini:0, Basic:0, Unlimited:0 }; let status = { active:0, soon:0, expired:0 };
    if (serversRows.length) {
      const serverIds = serversRows.map(s => s.id);
      const { rows: userRows } = await pool.query('SELECT u.server_id, u.service_type, u.expire_date, u.account_name FROM users u WHERE u.server_id = ANY($1::int[])', [serverIds]);
      const parseCutoff = (val) => {
        if (!val) return null;
        try {
          const s = String(val);
          const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (m) { const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]); return new Date(y, mo - 1, d + 1, 0, 0, 0, 0); }
          const dt = new Date(s);
          if (!isNaN(dt.getTime())) return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
        } catch (_) {}
        return null;
      };
      for (const row of (userRows || [])) {
        totalUsers++;
        const v = (row.service_type || '').toLowerCase();
        const svc = (v === 'mini' || v === 'xray' || v === 'x-ray' || v === 'outline') ? 'Mini' : (v === 'basic' ? 'Basic' : (v === 'unlimited' ? 'Unlimited' : row.service_type || ''));
        if (svc === 'Mini') tiers.Mini++; else if (svc === 'Basic') tiers.Basic++; else if (svc === 'Unlimited') tiers.Unlimited++;
        const cutoff = parseCutoff(row.expire_date);
        if (!cutoff) { status.active++; continue; }
        const diff = cutoff.getTime() - now.getTime();
        if (diff <= 0) status.expired++; else if (diff <= 24*60*60*1000) status.soon++; else status.active++;
      }
    }
    const statsText = `\n\n<b>Stats</b>\nServers: ${serversRows.length} | Users: ${totalUsers}\nTiers: Mini ${tiers.Mini}, Basic ${tiers.Basic}, Unlimited ${tiers.Unlimited}\nStatus: Active ${status.active}, Soon ${status.soon}, Expired ${status.expired}`;
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [ { text: '📡 Server List', callback_data: 'servers' }, { text: '⏳ Expire Soon', callback_data: 'soon' } ],
          [ { text: '⚠️ Expired Users', callback_data: 'expired' } ]
        ]
      }
    };
    console.log('--- Message Payload ---');
    console.log('text:');
    console.log(header + statsText);
    console.log('reply_markup:');
    console.log(JSON.stringify(keyboard, null, 2));
    await pool.end();
  } catch (e) {
    console.error('ERROR:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
