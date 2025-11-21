#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function main() {
  const serverId = process.argv[2] || '1';
  const tokenPath = process.argv[3] || path.join(__dirname, '..', 'temp_token.txt');
  const tokenLines = fs.readFileSync(tokenPath, 'utf8').trim().split(/\r?\n/);
  // take the last non-empty line that looks like a JWT (has 2 dots)
  const token = tokenLines.reverse().find(l => l && l.includes('.'))?.trim() || '';
  const base = 'http://localhost:3001/api/users/server/' + serverId;
  const urls = [
    base + '/export',
    base + '/export.xlsx',
    base + '/template',
    base + '/template.xlsx',
  ];
  for (const url of urls) {
    // unauthenticated check
    try {
      const res = await axios.get(url, { validateStatus: () => true, responseType: 'arraybuffer' });
      console.log(url, '(no auth)', '->', res.status);
    } catch (e) {
      console.log(url, '(no auth)', '-> ERROR', e.message);
    }
    // authenticated check if token present
    if (token && token.length > 20) {
      try {
        const res2 = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true, responseType: 'arraybuffer' });
        const ct = res2.headers['content-type'];
        console.log(url, '(auth)', '->', res2.status, ct || '');
      } catch (e2) {
        console.log(url, '(auth)', '-> ERROR', e2.message);
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
