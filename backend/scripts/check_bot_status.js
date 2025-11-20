const app = require('../app');
const request = require('supertest');
(async () => {
  try {
    const res = await request(app).get('/internal/bot/status');
    console.log(JSON.stringify(res.body, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Failed to fetch bot status via app router:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();
