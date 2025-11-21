require('dotenv').config();
const keys = ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_DATABASE'];
const info = keys.map(k => ({ key: k, set: process.env[k] !== undefined && process.env[k] !== '', value: k==='DB_PASSWORD' && process.env[k] ? '<redacted>' : process.env[k] }));
console.log('DB env vars:');
info.forEach(i => console.log(`${i.key}: ${i.set ? i.value : '<NOT SET>'}`));

if (info.some(i => !i.set)) {
  console.log('\nTip: set in PowerShell like:');
  console.log("$env:DB_HOST='localhost'; $env:DB_PORT='5432'; $env:DB_USER='pguser'; $env:DB_PASSWORD='s3cret'; $env:DB_DATABASE='mydb'");
}
