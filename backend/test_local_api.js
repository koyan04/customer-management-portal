const axios = require('axios');

async function testLocalAPI() {
  try {
    // Step 1: Login
    console.log('Logging in to local backend...');
    const loginResponse = await axios.post('http://localhost:3001/api/auth/login', {
      username: 'admin',
      password: 'admin123'  // Replace with actual admin password
    });
    
    const token = loginResponse.data.token;
    console.log('✓ Login successful');
    
    // Step 2: Fetch financial data
    console.log('\nFetching financial data...');
    const financialResponse = await axios.get('http://localhost:3001/api/admin/financial', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    console.log('\n=== API Response ===');
    console.log('Status:', financialResponse.status);
    console.log('Currency in response:', financialResponse.data.currency);
    console.log('Number of months:', financialResponse.data.months?.length);
    console.log('First month has currency field?', 'currency' in (financialResponse.data.months?.[0] || {}));
    console.log('\nFirst month sample:');
    console.log(JSON.stringify(financialResponse.data.months?.[0], null, 2));
    
  } catch (error) {
    console.error('\n❌ ERROR:', error.response?.data || error.message);
    console.error('Status:', error.response?.status);
  }
}

testLocalAPI();
