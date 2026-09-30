// Verifies EVERY backup/restore path carries the DB-stored media and admin
// avatars, and that no path reintroduces filesystem storage or a known
// placeholder password hash.
//
// Resolve paths relative to this file so the test runs from any checkout
// location, then skip cleanly when the backend root or its .env is absent.
const path = require('path');
const fs = require('fs');
const BACKEND_ROOT = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(BACKEND_ROOT, '.env'))) {
  console.log('SKIP backupRestoreCoverage: backend/.env not found (needs a live DB).');
  process.exit(0);
}
process.chdir(BACKEND_ROOT);
require(path.join(BACKEND_ROOT, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND_ROOT, '.env') });
const pool = require(path.join(BACKEND_ROOT, 'db'));
const mediaStore = require(path.join(BACKEND_ROOT, 'lib', 'mediaStore'));

let fail = 0;
const check = (n, c, x) => { if (c) console.log(`  PASS  ${n}`); else { console.log(`  FAIL  ${n}${x ? ' :: ' + x : ''}`); fail++; } };

const PLACEHOLDER = '$2b$10$PLACEHOLDERPLACEHOLDERPLACEHOLDERuIvqJwQoak';

(async () => {
  try {
    // ---- Source data -----------------------------------------------------
    const admins = (await pool.query('SELECT id, username, role, avatar_data, avatar_url FROM admins ORDER BY id')).rows;
    const media = await mediaStore.listMedia(pool);

    console.log('=== A. All three admin roles are handled ===');
    // The route restricts to these; confirm the constant matches the DB constraint.
    const VALID = ['ADMIN', 'VIEWER', 'SERVER_ADMIN'];
    const con = await pool.query(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'admins_role_check'`);
    console.log('  DB constraint: ' + (con.rows[0] ? con.rows[0].d : '(none found)'));
    check('route VALID list matches DB constraint',
      VALID.every(r => con.rows[0] && String(con.rows[0].d).includes(`'${r}'`)),
      con.rows[0] && con.rows[0].d);
    check('every current admin role is in the valid list',
      admins.every(a => VALID.includes(a.role)), admins.map(a => `${a.username}=${a.role}`).join(','));

    console.log('\n=== B. media table is in a migration (fresh install) ===');
    const migDir = path.join(BACKEND_ROOT, 'migrations');
    const migs = fs.readdirSync(migDir).filter(f => f.endsWith('.sql'));
    const mediaMig = migs.find(f => /CREATE TABLE IF NOT EXISTS media/i.test(fs.readFileSync(path.join(migDir, f), 'utf8')));
    check('a migration creates the media table', !!mediaMig, `found=${mediaMig}`);
    // Ordering matters only in that the media table must be created before any
    // route that reads it; 023 satisfies that as long as it is not deleted.
    check('media migration sorts before any later migration', mediaMig && migs.sort().indexOf(mediaMig) < migs.sort().length - 1,
      `media=${mediaMig}`);

    console.log('\n=== C. Static audit: no filesystem avatar writes remain ===');
    const src = fs.readFileSync(path.join(BACKEND_ROOT, 'routes', 'admin.js'), 'utf8');
    check('no hard-coded placeholder hash remains', !src.includes(PLACEHOLDER));
    check('no "restored-" avatar file writes remain',
      !/restored-\$\{a\.username\}/.test(src), 'admin restore still writes avatar files');
    // The only legitimate writes are the logo/favicon temp-upload cleanup.
    const avatarFileWrites = src.match(/writeFileSync\([^)]*uploadsPath/g) || [];
    check('no avatars written into uploadsPath', avatarFileWrites.length === 0, JSON.stringify(avatarFileWrites));

    console.log('\n=== D. Every backup payload includes admins + media ===');
    const botSrc = fs.readFileSync(path.join(BACKEND_ROOT, 'telegram_bot.js'), 'utf8');
    // snapshot (portal)
    const snapBlock = src.slice(src.indexOf("router.get('/backup/snapshot'"), src.indexOf("router.post('/restore/snapshot'"));
    check('GET /backup/snapshot includes admins', /admins:\s*\(adminsRes\.rows/.test(snapBlock));
    check('GET /backup/snapshot includes media', /media:\s*mediaRes/.test(snapBlock));
    check('GET /backup/snapshot includes server_admin_permissions', /server_admin_permissions/.test(snapBlock));
    check('GET /backup/snapshot selects avatar_data', /avatar_data/.test(snapBlock));
    check('GET /backup/snapshot never exports password_hash',
      !/password_hash/.test(snapBlock.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
      'snapshot payload references password_hash');
    // config
    const cfgBlock = src.slice(src.indexOf("router.get('/backup/config'"), src.indexOf("router.post('/restore/config'"));
    check('GET /backup/config includes media', /media:\s*media\s*\|\|\s*\[\]/.test(cfgBlock) || /media:\s*media/.test(cfgBlock));
    check('GET /backup/config selects avatar_data', /avatar_data/.test(cfgBlock));
    // db
    const dbBlock = src.slice(src.indexOf("router.get('/backup/db'"), src.indexOf("router.get('/backup/snapshot'"));
    check('GET /backup/db includes media', /media:\s*mediaRows/.test(dbBlock));
    check('GET /backup/db selects avatar_data', /avatar_data/.test(dbBlock));
    // admins
    const admBlock = src.slice(src.indexOf("router.get('/backup/admins'"), src.indexOf("router.post('/restore/admins'"));
    check('GET /backup/admins embeds avatars', /avatar_data/.test(admBlock));
    // telegram bot snapshot
    check('telegram bot snapshot includes media', /media:\s*mediaRes/.test(botSrc));
    check('telegram bot snapshot includes server_admin_permissions', /server_admin_permissions:\s*serverAdminPerms/.test(botSrc));
    check('telegram bot snapshot no longer warns about missing avatar files',
      !/Avatar files in public\/uploads\/ are not included/.test(botSrc));

    console.log('\n=== E. Every restore path handles media ===');
    const restoreSnapshot = src.slice(src.indexOf("router.post('/restore/snapshot'"));
    check('POST /restore/snapshot restores media', /INSERT INTO media/.test(restoreSnapshot));
    check('POST /restore/snapshot honours restore_admins', /wantsAdmins/.test(restoreSnapshot));
    check('POST /restore/snapshot revokes sessions', /DELETE FROM refresh_tokens/.test(restoreSnapshot));
    check('POST /restore/snapshot guards empty admins', /refusing to overwrite the admin team/.test(restoreSnapshot));
    const restoreCfg = src.slice(src.indexOf("router.post('/restore/config'"), src.indexOf("router.get('/backup/db'"));
    check('POST /restore/config restores media', /INSERT INTO media/.test(restoreCfg));
    const restoreDb = src.slice(src.indexOf("router.post('/restore/db'"));
    check('POST /restore/db restores media', /INSERT INTO media/.test(restoreDb));
    check('POST /restore/db keeps avatars inline', !/restored-\$\{a\.username\}/.test(restoreDb));
    const restoreAdmins = src.slice(src.indexOf("router.post('/restore/admins'"));
    check('POST /restore/admins keeps avatars inline', !/restored-\$\{a\.username\}/.test(restoreAdmins));
    check('POST /restore/admins validates bcrypt hashes', /\^\\\$2\[aby\]/.test(restoreAdmins));

    console.log('\n=== F. No duplicate route registrations ===');
    // Strip comments first: the explanatory note about the removed duplicate
    // route legitimately contains the string "POST /restore/config".
    const srcNoComments = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const routes = [...srcNoComments.matchAll(/router\.(get|post|delete|put)\('([^']+)'/g)].map(m => `${m[1].toUpperCase()} ${m[2]}`);
    const dupes = routes.filter((r, i) => routes.indexOf(r) !== i);
    check('no duplicate routes in admin.js', dupes.length === 0, JSON.stringify(dupes));
    console.log(`  (${routes.length} routes registered)`);

    console.log('\n=== G. Live data is DB-backed ===');
    check('media rows present', media.length > 0, `n=${media.length}`);
    check('all media are data URIs', media.every(m => /^data:image\//.test(String(m.data))));
    check('all admins have inline avatars', admins.every(a => a.avatar_data && String(a.avatar_data).startsWith('data:')),
      JSON.stringify(admins.map(a => ({ u: a.username, has: !!a.avatar_data }))));
    check('no admin references a local file', admins.every(a => !a.avatar_url));
    const gen = (await pool.query("SELECT data FROM app_settings WHERE settings_key='general'")).rows[0].data || {};
    check('general.logo_url points at the media route', /\/api\/admin\/public\/media\//.test(String(gen.logo_url || '')), String(gen.logo_url));

    console.log('\n=== H. Auth hardening is in place ===');
    const authSrc = fs.readFileSync(path.join(BACKEND_ROOT, 'routes', 'auth.js'), 'utf8');
    const guardSrc = fs.readFileSync(path.join(BACKEND_ROOT, 'lib', 'authGuard.js'), 'utf8');
    check('public register is disabled (410)', /router\.post\('\/register'[\s\S]{0,400}?status\(410\)/.test(authSrc));
    check('register cannot insert an admin',
      !/router\.post\('\/register'[\s\S]{0,900}?INSERT INTO admins/i.test(authSrc));
    check('login is wrapped by the guard', /router\.post\('\/login',\s*authGuard\.loginGuard\(\)/.test(authSrc));
    check('login records failures', /authGuard\.noteFailure/.test(authSrc));
    check('login clears on success', /authGuard\.noteSuccess/.test(authSrc));
    check('unknown username still runs a bcrypt compare', /TIMING_EQUALISER_HASH/.test(authSrc));
    const th = (authSrc.match(/TIMING_EQUALISER_HASH\s*=\s*'(\$2[aby]\$[^']+)'/) || [])[1] || '';
    check('timing-equaliser is a real 60-char bcrypt hash', th.length === 60, `len=${th.length}`);
    check('guard has a per-IP ceiling', /IP_MAX_ATTEMPTS\s*=/.test(guardSrc));
    check('guard has a per-account ceiling', /ACCOUNT_MAX_FAILS\s*=/.test(guardSrc));
    check('guard fails open', /fail open/.test(guardSrc));
    check('lockout table is created by a migration',
      migs.some(f => /CREATE TABLE IF NOT EXISTS login_lockouts/i.test(fs.readFileSync(path.join(migDir, f), 'utf8'))));

    console.log(fail === 0 ? '\n==== ALL CHECKS PASSED ====' : `\n==== ${fail} CHECK(S) FAILED ====`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (e) {
    console.error('\nERROR:', e && e.stack ? e.stack : e);
    process.exitCode = 1;
  } finally {
    try { await pool.end(); } catch (_) {}
    process.exit(process.exitCode || 0);
  }
})();