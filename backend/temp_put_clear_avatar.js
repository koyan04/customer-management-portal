require('dotenv').config();
const http = require('http');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const token = jwt.sign({ user: { id: 1, role: 'ADMIN' } }, process.env.JWT_SECRET, { expiresIn: '24h' });
const data = JSON.stringify({ display_name: 'Yu Yu 01', role: 'VIEWER', clear_avatar: true });

const opts = {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'Authorization': 'Bearer ' + token
  }
};

const req = http.request('http://localhost:3001/api/admin/accounts/3', opts, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    console.log('HTTP', res.statusCode, b);
    // print last bit of server logs
    try {
      const out = fs.existsSync('server_out.log') ? fs.readFileSync('server_out.log', 'utf8') : '';
      const err = fs.existsSync('server_err.log') ? fs.readFileSync('server_err.log', 'utf8') : '';
      console.log('\n--- server_out.log (tail) ---\n', out.slice(-2000));
      console.log('\n--- server_err.log (tail) ---\n', err.slice(-2000));
    } catch (e) { console.error('Failed reading logs', e); }
  });
});
req.on('error', e => console.error('Request error', e));
req.write(data);
req.end();
