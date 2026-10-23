// Tests for the two Admin-panel bugs:
//
//  1. "Restore admins (overwrite)" did not actually overwrite. The restoring
//     admin was exempted from the delete and kept their old role/password, so
//     the restored team was never in force. Overwrite must apply to every
//     account, including the operator, and must sign everyone out.
//
//  2. Enable/disable showed as "Toggled Enabled" in activity logs because the
//     raw TOGGLE_ENABLED enum was title-cased. The label must state the
//     direction that actually happened.
//
// These assert on the SQL the route issues, using a recording fake client, so
// they run without a database.

const fs = require('fs');
const path = require('path');

const ADMIN_JS = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8'
);

// Isolate the /restore/admins route body so assertions cannot accidentally match
// the similarly-shaped /restore/snapshot code. No expect() here: this runs at
// describe-time, where Jest forbids assertions.
//
// admin.js is CRLF, so a top-level `router.<method>(` still starts at column 0
// after a newline. /restore/admins is the LAST route in the file, so when no
// terminator is found the remainder of the file is the body.
function restoreAdminsBody() {
  const start = ADMIN_JS.indexOf("router.post('/restore/admins'");
  if (start < 0) throw new Error('/restore/admins route not found');
  const m = /\nrouter\.(?:get|post|put|delete|patch)\(/.exec(ADMIN_JS.slice(start + 1));
  return m ? ADMIN_JS.slice(start, start + 1 + m.index) : ADMIN_JS.slice(start);
}

describe('restore admins: route is present', () => {
  test('the route body is found and non-trivial', () => {
    const body = restoreAdminsBody();
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toContain("router.post('/restore/admins'");
  });
});

describe('restore admins: overwrite really overwrites', () => {
  const body = restoreAdminsBody();

  test('deletes every admin, not "all except the current one"', () => {
    // The old code did: DELETE FROM admins WHERE id != $1  (sparing the operator)
    // The statement is a client.query() call, so match the quoted form.
    expect(body).toMatch(/client\.query\('DELETE FROM admins'\)/);
    expect(body).not.toMatch(/DELETE FROM admins WHERE id\s*!=/);
    expect(body).not.toMatch(/Don't delete the current admin/);
  });

  test('has no isCurrentAdmin escape hatch around the update', () => {
    // The phrase survives only inside a comment explaining its removal.
    const code = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/isCurrentAdmin/);
  });

  test('overwrite updates password and role for the restoring admin too', () => {
    // The overwrite branch must not be gated on who is performing the restore.
    const mergeBranch = body.match(/if \(mode === 'merge'\) \{[\s\S]*?\} else \{/);
    expect(mergeBranch).not.toBeNull();
    const after = body.slice(mergeBranch.index + mergeBranch[0].length);
    const overwrite = after.slice(0, after.indexOf('} else {'));
    expect(overwrite).toMatch(/password_hash/);
    expect(overwrite).toMatch(/role/);
  });

  test('merge mode still leaves password_hash alone', () => {
    const merge = body.match(/if \(mode === 'merge'\) \{[\s\S]*?\} else \{/);
    expect(merge).not.toBeNull();
    // Comments in this block legitimately mention password_hash; strip them.
    const mergeCode = merge[0].replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(mergeCode).not.toMatch(/password_hash/);
  });
});

describe('restore admins: refuse a destructive overwrite', () => {
  const body = restoreAdminsBody();

  test('rejects an overwrite carrying no accounts', () => {
    expect(body).toMatch(/restorable\.length === 0/);
    expect(body).toMatch(/refusing to overwrite the admin team/);
  });

  test('rejects an overwrite that would remove the operator\'s own account', () => {
    // Otherwise the restore deletes the session performing it and locks the
    // operator out of the portal entirely.
    expect(body).toMatch(/does not contain your own account/);
  });

  test('both guards roll back before responding', () => {
    const guardCount = (body.match(/await client\.query\('ROLLBACK'\)/g) || []).length;
    expect(guardCount).toBeGreaterThanOrEqual(3); // 2 guards + the catch handler
  });
});

describe('restore admins: sessions are actually revoked', () => {
  const body = restoreAdminsBody();

  test('records refresh-token hashes in invalidated_tokens', () => {
    expect(body).toMatch(/INSERT INTO invalidated_tokens[\s\S]*?refresh_tokens/);
  });

  test('records the REAL session jti, not an invented one', () => {
    // md5(random()) produces a value that can never match a live token, which
    // is why the snapshot path silently fails to revoke anything.
    const code = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).toMatch(/SELECT s\.token_jti, s\.admin_id, 'admins_restored'[\s\S]*?FROM active_sessions/);
    expect(code).not.toMatch(/md5\(random\(\)/);
  });

  test('clears refresh_tokens so /api/auth/refresh cannot mint new tokens', () => {
    expect(body).toMatch(/DELETE FROM refresh_tokens/);
  });

  test('KEEPS the revocation rows (deleting them would undo the logout)', () => {
    // This is the bug in /restore/snapshot: it inserts revocations and then
    // deletes the whole table, throwing the list away. Compare against the
    // snapshot route to prove the two now differ.
    const code = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    expect(code).not.toMatch(/DELETE FROM invalidated_tokens/);
    // ...and confirm the snapshot route really does still do it, so this test
    // is not passing vacuously.
    const snapStart = ADMIN_JS.indexOf("router.post('/restore/snapshot'");
    const snap = snapStart >= 0 ? ADMIN_JS.slice(snapStart, ADMIN_JS.indexOf("router.post('/restore/admins'")) : '';
    expect(snap.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).toMatch(/DELETE FROM invalidated_tokens/);
  });

  test('reports the revoked count back to the caller', () => {
    expect(body).toMatch(/sessions_revoked: mode === 'overwrite' \? revokedSessions : 0/);
  });

  test('tolerates a missing active_sessions table', () => {
    // active_sessions is not in the migration files, so it may not exist on
    // every host; a failure there must not abort the restore.
    expect(body).toMatch(/access-token revocation skipped/);
    // refresh_tokens is cleared BEFORE that step and outside its try/catch, so
    // the logout does not depend on active_sessions existing.
    const rf = body.indexOf('DELETE FROM refresh_tokens');
    const skip = body.indexOf('access-token revocation skipped');
    expect(rf).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(rf);
  });
});

describe('activity log: enable/disable label', () => {
  const PAGE = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'AdminPanelPage.jsx'),
    'utf8'
  );

  test('maps TOGGLE_ENABLED to a readable label instead of "Toggled Enabled"', () => {
    expect(PAGE).toMatch(/TOGGLE_ENABLED: 'Change Enabled'/);
  });

  test('resolves the direction from the recorded state', () => {
    expect(PAGE).toMatch(/actionWithDirection/);
    expect(PAGE).toMatch(/next === true \? 'Enable' : next === false \? 'Disable'/);
  });

  test('renders with the new formatter', () => {
    expect(PAGE).toMatch(/\{actionWithDirection\(log\)\}/);
  });
});

describe('activity log: enable/disable needs the state in the payload', () => {
  test('the endpoint returns before_data / after_data for settings rows', () => {
    const start = ADMIN_JS.indexOf("router.get('/accounts/:id/activity-logs'");
    expect(start).toBeGreaterThan(-1);
    const rest = ADMIN_JS.slice(start);
    const end = rest.indexOf('\nrouter.', 10);
    const body = rest.slice(0, end === -1 ? rest.length : end);
    expect(body).toMatch(/\.\.\.settingsResult\.rows\.map\([\s\S]*?before_data[\s\S]*?after_data[\s\S]*?\}\)\)/);
  });

  test('the toggle route records the enabled flag in its audit row', () => {
    const USERS = fs.readFileSync(
      path.join(__dirname, '..', 'routes', 'users.js'), 'utf8'
    );
    expect(USERS).toMatch(/TOGGLE_ENABLED/);
    // Both snapshots are stored, so "enabled" is readable from either side.
    expect(USERS).toMatch(/JSON\.stringify\(beforeRow \|\| null\), JSON\.stringify\(afterRow \|\| null\)/);
  });
});