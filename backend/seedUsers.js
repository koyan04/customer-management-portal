require('dotenv').config();
const pool = require('./db');

function daysFromNow(d) { return new Date(Date.now() + d*24*60*60*1000); }

async function seed() {
  try {
    const { rows: serverRows } = await pool.query('SELECT id, server_name FROM servers ORDER BY id');
    if (!serverRows.length) {
      console.log('No servers found; run seedServers first');
      process.exit(0);
    }
    // If users already exist, skip
    const { rows: userCountRows } = await pool.query('SELECT count(*)::int AS c FROM users');
    if (userCountRows[0].c > 0) {
      console.log('Users already present, skipping sample seed');
      process.exit(0);
    }
    const tiers = ['Mini','Basic','Unlimited','Mini','Basic'];
    let inserted = 0;
    for (const s of serverRows) {
      for (let i=0; i<5; i++) {
        const name = `${s.server_name.split(' ')[0].toLowerCase()}_user_${i+1}`.replace(/[^a-z0-9_]/gi,'_');
        const tier = tiers[i];
        const expire = daysFromNow(5 + i*10); // 5,15,25,35,45 days
        await pool.query('INSERT INTO users (server_id, account_name, service_type, expire_date) VALUES ($1,$2,$3,$4)', [s.id, name, tier, expire]);
        inserted++;
      }
    }
    console.log('Inserted', inserted, 'sample users');
    process.exit(0);
  } catch (e) {
    console.error('Failed to seed users:', e && e.message ? e.message : e);
    process.exit(1);
  }
}
seed();
