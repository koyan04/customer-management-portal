const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const http = require('http');

async function run() {
  const fd = new FormData();
  fd.append('display_name','Node Test');
  fd.append('username','node_test_user');
  fd.append('password','secretpass');
  // small sample file
  fd.append('avatar', Buffer.from([0x89,0x50,0x4E,0x47]), { filename: 'avatar.png', contentType: 'image/png' });

  const options = {
    method: 'post',
    host: 'localhost',
    port: 3001,
    path: '/api/admin/accounts',
    headers: fd.getHeaders()
  };

  const req = http.request(options, (res) => {
    console.log('STATUS', res.statusCode);
    res.setEncoding('utf8');
    res.on('data', (chunk) => console.log('BODY', chunk));
    res.on('end', () => console.log('done'));
  });

  fd.pipe(req);
}

run().catch(err => console.error(err));
