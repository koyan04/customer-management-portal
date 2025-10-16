require('dotenv').config();
const pool = require('./db');

async function seed() {
  try {
    const { rows } = await pool.query('SELECT count(*)::int as cnt FROM servers');
    const cnt = rows && rows[0] ? rows[0].cnt : 0;
    if (cnt > 0) {
      console.log('Servers already seeded, count =', cnt);
      process.exit(0);
    }

    const servers = [
      { server_name: 'East Coast Cluster' },
      { server_name: 'West Coast Cluster' },
      { server_name: 'EU Central' }
    ];

    for (const s of servers) {
      await pool.query('INSERT INTO servers (server_name) VALUES ($1)', [s.server_name]);
    }

    console.log('Inserted', servers.length, 'servers');
    process.exit(0);
  } catch (err) {
    console.error('Failed to seed servers:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

seed();
