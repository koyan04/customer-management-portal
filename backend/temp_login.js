const http = require('http');
const data = JSON.stringify({ username: 'admin', password: 'admin123' });
const opts = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request('http://localhost:3001/api/auth/login', opts, res => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => console.log(b));
});
req.on('error', e => console.error(e));
req.write(data);
req.end();
