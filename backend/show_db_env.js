require('dotenv').config();

const keys = ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_DATABASE','TELEGRAM_BOT_TOKEN','ADMIN_JWT'];

function maskPw(pw) {
  if (!pw) return pw;
  return '*'.repeat(Math.max(3, Math.min(12, pw.length)));
}

console.log('Reading DB / bot env vars from process.env (note: password masked)');
for (const k of keys) {
  const v = process.env[k];
  if (typeof v === 'undefined' || v === null || String(v).trim() === '') {
    console.log(`${k}: <not set>`);
    continue;
  }
  if (k === 'DB_PASSWORD') {
    console.log(`${k}: ${maskPw(String(v))} (length=${String(v).length})`);
  } else if (k === 'TELEGRAM_BOT_TOKEN') {
    const s = String(v);
    console.log(`${k}: ${s.slice(0,6)}...${s.slice(-6)} (length=${s.length})`);
  } else {
    console.log(`${k}: ${v}`);
  }
}

// Helpful hint
console.log('\nIf any required DB env var is missing, set them in PowerShell, for example:');
console.log("$env:DB_HOST='localhost'; $env:DB_PORT='5432'; $env:DB_USER='pguser'; $env:DB_PASSWORD='s3cret'; $env:DB_DATABASE='mydb'");
