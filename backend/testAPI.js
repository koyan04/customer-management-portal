require('dotenv').config();
const axios = require('axios');

async function testAPI() {
  try {
    // First, login to get a token
    console.log('\n=== Testing API ===\n');
    console.log('1. Logging in as admin...');
    
    const loginResponse = await axios.post('http://127.0.0.1:3001/api/auth/login', {
      username: 'admin',
      password: process.env.SEED_ADMIN_PASSWORD || 'admin123'
    });
    
    const token = loginResponse.data.token;
    console.log('✓ Login successful, got token\n');
    
    // Now fetch accounts
    console.log('2. Fetching accounts from /api/admin/accounts...');
    const accountsResponse = await axios.get('http://127.0.0.1:3001/api/admin/accounts', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log(`✓ Got response with ${accountsResponse.data.length} accounts\n`);
    console.log('3. Account data:');
    console.log(JSON.stringify(accountsResponse.data, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Error:', err.response ? err.response.data : err.message);
    if (err.response) {
      console.error('Status:', err.response.status);
      console.error('Headers:', err.response.headers);
    }
    process.exit(1);
  }
}

testAPI();
