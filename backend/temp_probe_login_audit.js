const http = require('http');

function postJson(url, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = http.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: b }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      headers
    };
    const req = http.request(opts, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: b }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const base = process.env.BASE || 'http://localhost:3001';
  const username = process.env.USERNAME || 'admin';
  const password = process.env.PASSWORD || 'koyan04';
  const adminId = Number(process.env.ADMIN_ID || '1');
  console.log('Login -> fetch audit for admin', adminId, 'against', base);
  const login = await postJson(`${base}/api/auth/login`, { username, password });
  console.log('Login status:', login.status);
  if (!login.body || !login.body.token) {
    console.log('Login result:', login.body);
    process.exit(1);
  }
  const token = login.body.token;
  console.log('Token len:', token.length);
  const audit = await getJson(`${base}/api/admin/accounts/${adminId}/login-audit`, { Authorization: 'Bearer ' + token });
  console.log('Audit status:', audit.status);
  console.log('Audit body:', JSON.stringify(audit.body, null, 2));
})();
