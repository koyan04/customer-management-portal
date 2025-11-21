/*
  Simple E2E smoke test to create -> update -> delete an editor account via API.
  Usage (from project root):
    node scripts/e2e_smoke_test.js
  Requires environment variables:
    E2E_ADMIN_TOKEN - a valid admin JWT
    BASE_URL - optional, defaults to http://localhost:3001
*/
const fetch = require('node-fetch');
const assert = require('assert');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const AUTH = process.env.E2E_ADMIN_TOKEN;
if (!AUTH) {
  console.error('ERROR: set E2E_ADMIN_TOKEN environment variable to a valid admin JWT');
  process.exit(2);
}

(async () => {
  try {
    console.log('E2E smoke test start');
    // Create
    const createRes = await fetch(`${BASE}/api/admin/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH}` },
  body: JSON.stringify({ display_name: 'E2E Test', username: `e2e_${Date.now()}`, password: 'passw0rd', role: 'VIEWER' })
    });
    assert(createRes.ok, `Create failed: ${createRes.status}`);
    const created = await createRes.json();
    console.log('Created account id=', created.id);

    // Update
    const newDisplay = 'E2E Test Updated';
    const updateRes = await fetch(`${BASE}/api/admin/accounts/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH}` },
  body: JSON.stringify({ display_name: newDisplay, role: 'VIEWER' })
    });
    assert(updateRes.ok, `Update failed: ${updateRes.status}`);
    const updated = await updateRes.json();
    console.log('Updated:', updated.display_name);

    // Delete
    const deleteRes = await fetch(`${BASE}/api/admin/accounts/${created.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${AUTH}` }
    });
    assert(deleteRes.ok, `Delete failed: ${deleteRes.status}`);
    console.log('Deleted account', created.id);

    console.log('E2E smoke test passed');
    process.exit(0);
  } catch (err) {
    console.error('E2E smoke failed:', err.message || err);
    process.exit(3);
  }
})();
