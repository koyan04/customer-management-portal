const axios = require('axios');

const BASE = 'http://localhost:3001';
const SERVER_ID = 10;
const USERNAME = 'admin';
const PASSWORD = 'koyan04';

async function run() {
  try {
    console.log('Logging in...');
    const loginRes = await axios.post(`${BASE}/api/auth/login`, { username: USERNAME, password: PASSWORD });
    const token = loginRes.data && loginRes.data.token;
    if (!token) { console.error('Login failed: no token'); process.exit(2); }
    console.log('Got token:', token.substring(0, 20) + '...');

    const authHeader = { headers: { Authorization: `Bearer ${token}` } };

    console.log('Creating key...');
    const createBody = {
      username: 'smoketest-user',
      description: 'smoke test',
      original_key: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQtest 192.168.0.5',
      generated_key: 'gen-placeholder'
    };
    const createRes = await axios.post(`${BASE}/api/servers/${SERVER_ID}/keys`, createBody, authHeader);
    console.log('Create response:', createRes.status, createRes.data);
    const createdId = createRes.data && createRes.data.id;

    console.log('Listing keys...');
    const listRes = await axios.get(`${BASE}/api/servers/${SERVER_ID}/keys`, authHeader);
    console.log('List response:', listRes.status);
    console.log(JSON.stringify(listRes.data, null, 2));

    // Try fetching each id returned in list to diagnose single-key GET behavior
    if (Array.isArray(listRes.data)) {
      for (const item of listRes.data) {
        try {
          console.log('\nAttempting single GET for id:', item.id);
          const singleTry = await axios.get(`${BASE}/api/servers/${SERVER_ID}/keys/${item.id}`, authHeader);
          console.log('Single GET success for id', item.id, singleTry.data);
        } catch (e) {
          console.error('Single GET failed for id', item.id, e.response ? { status: e.response.status, data: e.response.data } : e.message);
        }
      }
    }

    if (createdId) {
      console.log('Fetching single key (should include original_key)...');
      const singleRes = await axios.get(`${BASE}/api/servers/${SERVER_ID}/keys/${createdId}`, authHeader);
      console.log('Single key:', singleRes.status, singleRes.data);

      console.log('Updating generated_key...');
      const updRes = await axios.put(`${BASE}/api/servers/${SERVER_ID}/keys/${createdId}`, { generated_key: 'updated-gen-value' }, authHeader);
      console.log('Update response:', updRes.status, updRes.data);

      console.log('Deleting key...');
      const delRes = await axios.delete(`${BASE}/api/servers/${SERVER_ID}/keys/${createdId}`, authHeader);
      console.log('Delete response:', delRes.status, delRes.data);
    }

    console.log('Smoke test completed successfully.');
  } catch (err) {
    if (err.response) {
      console.error('Request failed:', err.response.status, err.response.data);
    } else {
      console.error('Error:', err.message || err);
    }
    process.exit(1);
  }
}

run();
