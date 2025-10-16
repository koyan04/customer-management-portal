const axios = require('axios');

async function assertArray(path) {
  try {
    const res = await axios.get(path);
    const d = res.data;
    if (!Array.isArray(d)) {
      console.error(`${path} did not return an array. Received:`, typeof d, d);
      return false;
    }
    console.log(`${path} returned array (length ${d.length})`);
    return true;
  } catch (err) {
    console.error('Error calling', path, err.message || err);
    return false;
  }
}

(async function run() {
  const base = process.env.API_BASE || 'http://localhost:3001';
  const ok1 = await assertArray(`${base}/api/servers`);
  const ok2 = await assertArray(`${base}/api/admin/accounts`);

  if (!ok1 || !ok2) {
    console.error('One or more API shape checks failed');
    process.exitCode = 2;
  } else {
    console.log('All API shape checks passed');
  }
})();
