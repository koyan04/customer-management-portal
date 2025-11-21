const FormData = require('form-data');
const http = require('http');

function makeBuffer(size) {
  return Buffer.alloc(size, 0x61);
}

(async function(){
  const fd = new FormData();
  fd.append('display_name','Node Large Test');
  fd.append('username','node_large_test');
  fd.append('password','secretpass');
  const buf = makeBuffer(100 * 1024); // 100KB
  fd.append('avatar', buf, { filename: 'avatar.png', contentType: 'image/png' });

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
})();
