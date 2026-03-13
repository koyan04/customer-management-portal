const pool = require('./db');

async function checkLocalDB() {
  try {
    // Check currency setting
    const currencyResult = await pool.query(`SELECT data FROM app_settings WHERE settings_key = 'general'`);
    console.log('\n=== Currency Setting ===');
    console.log('General settings data:', JSON.stringify(currencyResult.rows[0]?.data, null, 2));
    console.log('Currency:', currencyResult.rows[0]?.data?.currency || 'NOT SET');
    
    // Check if migration 022 is applied (server_id column exists)
    const columnCheck = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'monthly_financial_snapshots' 
      AND column_name = 'server_id'
    `);
    console.log('\n=== Migration 022 Status ===');
    console.log('server_id column exists:', columnCheck.rows.length > 0 ? 'YES' : 'NO');
    
    // Check snapshots count
    const snapshotCount = await pool.query(`SELECT COUNT(*) FROM monthly_financial_snapshots`);
    console.log('\n=== Snapshots ===');
    console.log('Total snapshots:', snapshotCount.rows[0].count);
    
    // Get sample snapshot if exists
    const sampleSnapshot = await pool.query(`SELECT * FROM monthly_financial_snapshots LIMIT 1`);
    if (sampleSnapshot.rows.length > 0) {
      console.log('Sample snapshot columns:', Object.keys(sampleSnapshot.rows[0]).join(', '));
    }
    
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('ERROR:', err.message);
    pool.end();
    process.exit(1);
  }
}

checkLocalDB();
