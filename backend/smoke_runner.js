const { spawn } = require('child_process');
const axios = require('axios');
const path = require('path');
const os = require('os');

// This script runs migrations, starts the backend server, runs the API shape test, then stops the server.
// Usage: node smoke_runner.js

const backendDir = path.resolve(__dirname);
const migrateCmd = 'npm';
const migrateArgs = ['run', 'migrate'];
const testCmd = 'npm';
const testArgs = ['run', 'test-api-shapes'];

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    p.on('exit', code => code === 0 ? resolve(0) : reject(new Error('Exit code ' + code)));
    p.on('error', err => reject(err));
  });
}

async function waitForServer(url, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await axios.get(url);
      return true;
    } catch (e) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return false;
}

(async function main() {
  try {
    console.log('Running migrations...');
    await runCommand(migrateCmd, migrateArgs, { cwd: backendDir });
  } catch (err) {
    console.error('Migrations failed:', err.message || err);
    process.exit(1);
  }

  console.log('Starting backend server...');
  const server = spawn('node', ['index.js'], { cwd: backendDir, stdio: 'inherit', shell: true });

  const cleanup = () => {
    try { server.kill(); } catch (e) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });

  try {
    const up = await waitForServer('http://localhost:3001');
    if (!up) throw new Error('Server did not start in time');

    console.log('Running API shape tests...');
    await runCommand(testCmd, testArgs, { cwd: backendDir });

    console.log('Smoke tests passed');
    cleanup();
    process.exit(0);
  } catch (err) {
    console.error('Smoke test failed:', err.message || err);
    cleanup();
    process.exit(2);
  }
})();
