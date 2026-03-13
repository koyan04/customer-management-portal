const fs = require('fs');
const p = '/srv/cmp/backend/data/keyserver.json';
const c = JSON.parse(fs.readFileSync(p));
c.publicDomain = 'https://key.vchannel.dpdns.org';
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('updated publicDomain to:', c.publicDomain);
