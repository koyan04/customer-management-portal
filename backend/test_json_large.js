const http = require('http');

function makeBase64OfSize(bytes) {
  const buf = Buffer.alloc(bytes, 0x61); // fill with 'a'
  return buf.toString('base64');
}

const base64 = makeBase64OfSize(1500000); // ~1.5MB raw -> base64 grows to ~2MB
const payload = JSON.stringify({ display_name: 'TestLarge', username: 'testlarge', password: 'pass', role: 'VIEWER', avatar_data: 'data:image/png;base64,' + base64 });

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/admin/accounts',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  console.log('STATUS:', res.statusCode);
  res.setEncoding('utf8');
  res.on('data', (chunk) => console.log('BODY:', chunk));
  res.on('end', () => console.log('END'));
});

req.on('error', (e) => {
  console.error('Request error:', e);
});

req.write(payload);
req.end();
