// Quick script to check timezone setting in database
const pool = require('./db');

(async () => {
  try {
    const result = await pool.query(
      "SELECT data FROM app_settings WHERE settings_key = $1",
      ['general']
    );
    
    if (result.rows.length > 0) {
      const data = result.rows[0].data;
      console.log('General settings:', JSON.stringify(data, null, 2));
      console.log('\nTimezone value:', data.timezone || '(not set)');
    } else {
      console.log('No general settings found in database');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
    process.exit();
  }
})();
