require('dotenv').config();
const pool = require('./db');

async function checkTable() {
  try {
    const result = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'admins' 
      ORDER BY ordinal_position
    `);
    
    console.log('\n=== Admins Table Structure ===\n');
    result.rows.forEach(col => {
      console.log(`${col.column_name}: ${col.data_type}`);
    });
    
    const hasLastSeen = result.rows.some(col => col.column_name === 'last_seen');
    console.log(`\n✓ last_seen column exists: ${hasLastSeen ? 'YES' : 'NO'}`);
    
    if (!hasLastSeen) {
      console.log('\n→ Adding last_seen column...');
      await pool.query('ALTER TABLE admins ADD COLUMN last_seen timestamp without time zone');
      console.log('✓ last_seen column added successfully');
    }
    
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkTable();
