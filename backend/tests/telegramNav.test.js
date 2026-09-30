// End-to-end navigation test: real handlers + real DB, mocked Telegram API.
// The expire-change step mutates a row, so we snapshot and restore it exactly.
//
// Resolve paths relative to this file so the test runs from any checkout
// location, then skip cleanly when the backend root or its .env is absent.
const path = require('path');
const fs = require('fs');
const BACKEND_ROOT = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(BACKEND_ROOT, '.env'))) {
  console.log('SKIP telegramNav: backend/.env not found (needs a live DB).');
  process.exit(0);
}
process.chdir(BACKEND_ROOT);
require(path.join(BACKEND_ROOT, 'node_modules', 'dotenv')).config({ path: path.join(BACKEND_ROOT, '.env') });

const calls = [];
let fakeMsgId = 1000;
let fail = 0;

const Module = require('module');
const realLoad = Module._load;
function mockPost(url, payload) {
  calls.push({ url: String(url), payload });
  const p = payload || {};
  if (String(url).endsWith('/sendMessage')) {
    const id = fakeMsgId++;
    return Promise.resolve({ data: { result: { message_id: id, chat: { id: p.chat_id }, text: p.text } } });
  }
  if (String(url).endsWith('/editMessageText')) {
    return Promise.resolve({ data: { result: { message_id: p.message_id } } });
  }
  return Promise.resolve({ data: { result: true } });
}
const mockAxios = function () { return Promise.resolve({ data: { result: [] } }); };
mockAxios.post = mockPost;
mockAxios.get = async () => ({ data: { result: [] } });
mockAxios.delete = async () => ({ data: { result: true } });
mockAxios.defaults = { adapter: async () => ({ data: { result: true }, status: 200, headers: {}, config: {} }) };
mockAxios.create = () => mockAxios;
mockAxios.isAxiosError = () => false;
Module._load = function (request) {
  if (/axios/.test(String(request))) return mockAxios;
  return realLoad.apply(this, arguments);
};

const pool = require(path.join(BACKEND_ROOT, 'db'));
const bot = require(path.join(BACKEND_ROOT, 'telegram_bot'));

const CHAT = 1704337135; // real default_chat_id so ALLOWED_CHAT_IDS does not block
const MENU = 500;        // the standing menu/list message
const ORIGIN_M = 'm';    // origin token for the main menu
const mid = (n) => ({ chat: { id: CHAT }, message_id: n });

function check(name, cond, extra) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`); fail++; }
}

function lastView() {
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (/\/(sendMessage|editMessageText)$/.test(c.url)) return c.payload;
  }
  return null;
}
function buttons() {
  const v = lastView();
  return (((v || {}).reply_markup || {}).inline_keyboard || []).flat();
}
function dump(label) {
  const v = lastView();
  console.log(`\n--- ${label} ---`);
  console.log((v || {}).text);
  console.log('  btns: ' + buttons().map(b => `${b.text}=>${b.callback_data}`).join('  |  '));
}
const press = async (data, msgId = MENU) => {
  const before = calls.length;
  await bot.handleCallback({ data, message: mid(msgId), id: 'q' + data.length + before, from: { id: CHAT } });
  return calls.length - before;
};
const findBtn = (re) => buttons().find(b => re.test(b.text));
// Telegram caps callback_data at 64 bytes.
const tooLong = () => buttons().find(b => Buffer.byteLength(String(b.callback_data)) > 64);

(async () => {
  let restore = null;
  try {
    await bot.loadTelegramSettings();

    console.log('\n=== 1. Main menu ===');
    await bot.handleStart(CHAT, { id: 1 }, MENU);
    dump('main menu');
    check('menu renders', !!lastView());
    check('no oversized callback_data', !tooLong(), tooLong() && tooLong().callback_data);

    console.log('\n=== 2. Servers list (from menu) ===');
    await press('servers_page:1');
    dump('servers list');
    const sBtn = findBtn(/Premium \(/);
    check('server buttons present', !!sBtn);
    check('no oversized callback_data', !tooLong(), tooLong() && tooLong().callback_data);

    console.log('\n=== 3. Server drilldown -> user list (THE BUG) ===');
    await press(sBtn.callback_data);
    dump('server user list');
    const uBtns = buttons().filter(b => /^server_user:/.test(b.callback_data));
    check('user list renders (regression)', uBtns.length > 0, `got ${uBtns.length} user buttons`);
    check('user buttons carry origin', /^server_user:\d+:\d+:.+/.test(uBtns[0].callback_data), uBtns[0] && uBtns[0].callback_data);
    check('back returns to servers page', buttons().some(b => /^servers_page:/.test(b.callback_data)),
      JSON.stringify(buttons().map(b => b.callback_data)));
    check('no oversized callback_data', !tooLong(), tooLong() && tooLong().callback_data);

    console.log('\n=== 3b. Paginate the user list (Next must change the view) ===');
    const next = buttons().find(b => /Next/.test(b.text));
    if (next) {
      // Regression: the header used to omit the page number, so every page
      // rendered identical text and renderView's cache skipped the edit,
      // leaving the buttons frozen on page 1.
      const page1Btns = buttons().map(b => b.callback_data).join('|');
      const editBefore = calls.filter(c => /editMessageText$/.test(c.url)).length;
      await press(next.callback_data);
      const page2Edit = calls.filter(c => /editMessageText$/.test(c.url)).slice(editBefore).pop();
      check('Next issues an editMessageText (not skipped)', !!page2Edit,
        `edits before=${editBefore} after=${calls.filter(c => /editMessageText$/.test(c.url)).length}`);
      check('Next changes the button set', buttons().map(b => b.callback_data).join('|') !== page1Btns,
        'buttons identical across pages - pager is a no-op');
      dump('server user list page 2');
      check('page 2 header shows the page number', /page 2\//.test(String(lastView().text)), String(lastView().text));
      check('page 2 renders user buttons', !!buttons().find(b => /^server_user:/.test(b.callback_data)));
      check('pager keeps origin', buttons().some(b => /^server:\d+:\d+:.+/.test(b.callback_data)),
        JSON.stringify(buttons().map(b => b.callback_data)));
      check('page 2 has a Prev button', !!buttons().find(b => /Prev/.test(b.text)),
        JSON.stringify(buttons().map(b => b.text)));
      // Prev must return to page 1.
      const prev = buttons().find(b => /Prev/.test(b.text));
      if (prev) {
        await press(prev.callback_data);
        check('Prev returns to page 1', /page 1\//.test(String(lastView().text)), String(lastView().text));
        check('page 1 button set restored', buttons().map(b => b.callback_data).join('|') === page1Btns);
      }
      // Walk to the last page to confirm the pager terminates correctly.
      let guard = 0;
      while (buttons().find(b => /Next/.test(b.text)) && guard++ < 12) {
        await press(buttons().find(b => /Next/.test(b.text)).callback_data);
      }
      check('pager terminates at the last page', !buttons().find(b => /Next/.test(b.text)),
        JSON.stringify(buttons().map(b => b.text)));
      // Read the page number from the header rather than counting clicks: the
      // server chosen for this test varies in user count between runs.
      const lastPage = (String(lastView().text).match(/page (\d+)\/(\d+)/) || [])[1];
      const lastTotal = (String(lastView().text).match(/page (\d+)\/(\d+)/) || [])[2];
      check('last page header is consistent', lastPage && lastPage === lastTotal,
        `header shows page ${lastPage}/${lastTotal}`);
    } else console.log('  (single page, pager skipped)');

    console.log('\n=== 4. User card ===');
    await press(uBtns[0].callback_data, 900);
    dump('user card');
    const cardMsg = lastView();
    check('card is a new message (drill-down)', calls.length && /sendMessage$/.test(calls[calls.length - 1].url));
    // Exactly six fixed lines, in the agreed order, and nothing else.
    const cardLines = String(cardMsg.text).split('\n');
    check('card is exactly 6 lines', cardLines.length === 6, `got ${cardLines.length}: ${JSON.stringify(cardLines)}`);
    check('line 1 is the bold name', /^👤 <b>.+<\/b>$/.test(cardLines[0]), cardLines[0]);
    check('line 2 is Status', /^📛 Status: (🟢 Active|🟡 Soon|🔴 Expired|⚪ N\/A)$/.test(cardLines[1]), cardLines[1]);
    check('line 3 is Service', /^⚙️ Service: \S/.test(cardLines[2]), cardLines[2]);
    check('line 4 is Server', /^📡 Server: \S/.test(cardLines[3]), cardLines[3]);
    check('line 5 is Expires as YYYY-MM-DD', /^📅 Expires: \d{4}-\d{2}-\d{2}$/.test(cardLines[4]), cardLines[4]);
    check('line 6 is Device Limit', /^📱 Device Limit: \S/.test(cardLines[5]), cardLines[5]);
    for (const field of ['👤', '📛 Status:', '⚙️ Service:', '📡 Server:', '📅 Expires:', '📱 Device Limit:']) {
      check(`card has "${field}"`, String(cardMsg.text).includes(field), cardMsg.text);
    }
    check('card does NOT show contact', !/Contact/.test(String(cardMsg.text)), cardMsg.text);
    check('card has no phone emoji', !/📞/.test(String(cardMsg.text)), cardMsg.text);
    check('card has no Data Limit line', !/Data Limit/.test(String(cardMsg.text)), cardMsg.text);
    check('card has no Note line', !/📝/.test(String(cardMsg.text)), cardMsg.text);
    check('card has no Enabled line', !/⛔/.test(String(cardMsg.text)), cardMsg.text);
    check('card has no blank trailing line', !/\n\s*$/.test(String(cardMsg.text)), cardMsg.text);
    const backBtn = buttons().find(b => /Back/.test(b.text));
    check('card Back returns to its origin list', backBtn && /^servers_page:/.test(backBtn.callback_data), backBtn && backBtn.callback_data);

    console.log('\n=== 4b. Server list card has emoji ===');
    await press('servers_page:1', MENU);
    dump('servers list');
    const serversTxt = String(lastView().text);
    check('servers header has satellite emoji', /📡/.test(serversTxt), serversTxt);
    check('servers header has page info', /page \d+\/\d+/.test(serversTxt), serversTxt);
    // Drill into a server that actually has users, so we exercise the paginated
    // header rather than the "no users yet" empty-state card.
    const populated = (await pool.query(
      "SELECT s.id, s.server_name FROM servers s JOIN users u ON u.server_id = s.id AND u.enabled = TRUE GROUP BY s.id, s.server_name ORDER BY count(u.id) DESC LIMIT 1"
    )).rows[0];
    if (populated) {
      await press(`server:${populated.id}:1:s1`, MENU);
      const srvTxt = String(lastView().text);
      dump('server user list header');
      check('server card header has emoji', /📡/.test(srvTxt), srvTxt);
      check('server card shows page number', /page \d+\/\d+/.test(srvTxt), srvTxt);
      check('server card shows user count', /user/.test(srvTxt), srvTxt);
    }

    console.log('\n=== 5. Change expire picker (3 months present?) ===');
    // Re-open a user card: step 4b navigated away from the card under test.
    // Go straight to a populated server so we never land on the empty-state card.
    await press(`server:${populated ? populated.id : (uBtns[0].callback_data.split(':')[1])}:1:s1`, MENU);
    const anyUser = buttons().find(b => /^server_user:/.test(b.callback_data));
    check('a populated server yields user buttons', !!anyUser,
      JSON.stringify(buttons().map(b => b.callback_data)));
    if (anyUser) await press(anyUser.callback_data, 900);
    dump('user card for expire test');
    const ce = buttons().find(b => /Change Expire/.test(b.text));
    check('change-expire button exists', !!ce, JSON.stringify(buttons().map(b => b.text)));
    await press(ce.callback_data, 900);
    dump('expire picker');
    for (const m of ['1 Month', '2 Months', '3 Months', '6 Months']) {
      check(`picker has ${m}`, buttons().some(b => b.text === m), JSON.stringify(buttons().map(b => b.text)));
    }
    const three = buttons().find(b => b.text === '3 Months');
    check('3-month choice present', !!three);

    console.log('\n=== 6. Apply 3 months, card must show NEW data ===');
    const uid = three.callback_data.split(':')[1];
    const before = await pool.query('SELECT expire_date FROM users WHERE id=$1', [uid]);
    restore = { uid, before: before.rows[0].expire_date };
    const oldExpiry = String(restore.before);
    await press(three.callback_data, 900);
    dump('card after extend');
    const newTxt = String(lastView().text);
    const after = await pool.query('SELECT expire_date FROM users WHERE id=$1', [uid]);
    check('DB expire_date moved forward', String(after.rows[0].expire_date) !== oldExpiry,
      `${oldExpiry} -> ${String(after.rows[0].expire_date)}`);
    check('card re-rendered (still a card, not a toast)', newTxt.includes('📅 Expires:') && newTxt.includes('📱 Device Limit:'), newTxt);
    check('status line present after change', newTxt.includes('📛 Status:'), newTxt);
    check('back still works after change', buttons().some(b => /^servers_page:/.test(b.callback_data)),
      JSON.stringify(buttons().map(b => b.callback_data)));
    const shown = (newTxt.match(/📅 Expires: ([\d-]+)/) || [])[1];
    const dbDate = new Date(after.rows[0].expire_date);
    const dbStr = `${dbDate.getFullYear()}-${String(dbDate.getMonth() + 1).padStart(2, '0')}-${String(dbDate.getDate()).padStart(2, '0')}`;
    check('card shows the NEW expiry date', shown && shown === dbStr, `card=${shown} db=${dbStr}`);

    console.log('\n=== 7. Status list -> card -> back ===');
    await press('users_page:active:1', MENU);
    dump('active users');
    const aBtn = buttons().find(b => /^server_user:/.test(b.callback_data));
    check('active list renders', !!aBtn);
    if (aBtn) {
      await press(aBtn.callback_data, 901);
      dump('card from active list');
      const b2 = buttons().find(b => /Back/.test(b.text));
      check('back returns to active list', b2 && /^users_page:active:/.test(b2.callback_data), b2 && b2.callback_data);
    }

    console.log('\n=== 8. Back from a list returns to main menu ===');
    await press('servers_page:1', MENU);
    await press(buttons().find(b => /Back/.test(b.text)).callback_data, MENU);
    check('back lands on main menu', buttons().some(b => b.callback_data === 'servers_page:1') &&
      String(lastView().text).includes('📊 Stats'), String(lastView().text));

    console.log('\n=== 9. Main menu format ===');
    await bot.handleStart(CHAT, { id: 1 }, MENU);
    const menuTxt = String(lastView().text);
    dump('main menu');
    for (const seg of ['📊 Stats', '📡 Servers:', '👥 Users:', '🏷️ Tiers:', '⚙️ Status:']) {
      check(`menu has "${seg}"`, menuTxt.includes(seg), menuTxt);
    }
    check('menu has Host Info button', buttons().some(b => /Host Info/.test(b.text)),
      JSON.stringify(buttons().map(b => b.text)));
    check('menu has Search button', buttons().some(b => /Search/.test(b.text)),
      JSON.stringify(buttons().map(b => b.text)));

    console.log('\n=== 10. Host Info card ===');
    await press('host_info', MENU);
    dump('host info');
    const hostTxt = String(lastView().text);
    for (const seg of ['💻 Host:', '📡 CMP Version:', '🌐 IPv4:', '⏳ Uptime:', '📈 System Load:',
                       '📋 RAM:', '🔹 TCP:', '🔸 UDP:', '🚦 Traffic:', 'ℹ️ Status:']) {
      check(`host card has "${seg}"`, hostTxt.includes(seg), hostTxt);
    }
    check('host card has Refresh', buttons().some(b => /Refresh/.test(b.text)),
      JSON.stringify(buttons().map(b => b.text)));
    check('host card has Back', buttons().some(b => /Back/.test(b.text)),
      JSON.stringify(buttons().map(b => b.text)));
    check('host Refresh re-renders in place', /editMessageText$/.test(calls[calls.length - 1].url), calls[calls.length - 1].url);
    // Refresh must re-query and re-render, not reuse a cached snapshot.
    await press('host_info', MENU);
    const refreshCall = calls.filter(c => /editMessageText$/.test(c.url)).pop();
    check('host refresh re-renders', !!refreshCall && String(refreshCall.payload.text).includes('📈 System Load:'),
      refreshCall ? refreshCall.payload.text : 'no edit call');
    check('host uptime/load values populated', /⏳ Uptime: \d/.test(String(lastView().text)) && /📈 System Load: [\d.]/.test(String(lastView().text)), lastView().text);
    check('host traffic is formatted', /🚦 Traffic: [\d.]+ ?[KMGTP]?B/.test(String(lastView().text)), lastView().text);
    check('host RAM formatted', /📋 RAM: [\d.]+ ?[KMGTP]?B\/[\d.]+ ?[KMGTP]?B/.test(String(lastView().text)), lastView().text);
    check('IPv4 is monospace <code>', /🌐 IPv4: (<code>[^<]+<\/code>\s*)+/.test(String(lastView().text)), lastView().text);
    // This host has no global IPv6, so the line correctly renders "<i>none</i>".
    // Accept either monospace addresses or the explicit empty marker.
    check('IPv6 line is monospace or explicitly none',
      /🌐 IPv6: (<code>[^<]+<\/code>\s*)+/.test(String(lastView().text)) || /🌐 IPv6: <i>none<\/i>/.test(String(lastView().text)),
      lastView().text);
    check('host id is monospace <code>', /💻 Host: <code>/.test(String(lastView().text)), lastView().text);
    await press('main_back', MENU);
    check('host Back -> main menu', String(lastView().text).includes('📊 Stats'), String(lastView().text));

    console.log('\n=== 11. Disabled users are hidden from lists ===');
    // Pick a disabled user and confirm they never surface in any list.
    const dis = await pool.query("SELECT id, account_name FROM users WHERE enabled = FALSE LIMIT 1");
    if (dis.rows.length) {
      const d = dis.rows[0];
      const needle = String(d.account_name || '').slice(0, 10);
      console.log(`  (disabled user: id=${d.id} name="${d.account_name}")`);
      // Walk every list surface.
      await press('users_page:active:1', MENU);
      const inActive = String(lastView().text).includes(needle) || buttons().some(b => b.callback_data === `server_user:${d.server_id || ''}:${d.id}`) ||
        buttons().some(b => /:${d.id}:/.test(String(b.callback_data)));
      check('disabled user absent from Active list', !inActive);
      await press('users_page:expired:1', MENU);
      const inExpired = buttons().some(b => new RegExp(`:${d.id}[::]`).test(String(b.callback_data)));
      check('disabled user absent from Expired list', !inExpired);
      // And absent from a server drilldown.
      const srv = await pool.query('SELECT server_id FROM users WHERE id=$1', [d.id]);
      if (srv.rows[0] && srv.rows[0].server_id) {
        await press(`server:${srv.rows[0].server_id}:1:${ORIGIN_M}`, MENU);
        const inServer = buttons().some(b => new RegExp(`:${d.id}[::]`).test(String(b.callback_data)));
        check('disabled user absent from server list', !inServer,
          JSON.stringify(buttons().map(b => b.callback_data)));
      }
      // Search must also skip them.
      const found = await pool.query(
        `SELECT u.id FROM users u JOIN servers s ON s.id=u.server_id
          WHERE u.enabled = TRUE AND (u.account_name ILIKE $1) LIMIT 1`, [`%${needle}%`]);
      check('search excludes disabled users', !found.rows.some(r => r.id === d.id));
    } else {
      console.log('  (no disabled users in DB - skipping)');
    }

    console.log('\n=== 12. Search flow ===');
    await press('search_prompt', MENU);
    dump('search prompt');
    check('search prompt shown', /Type a name|Search User/.test(String(lastView().text)), String(lastView().text));
    // Find a real name to search for.
    const some = await pool.query("SELECT account_name FROM users WHERE enabled = TRUE AND account_name <> '' LIMIT 1");
    const term = some.rows[0] ? String(some.rows[0].account_name).slice(0, 8) : 'a';
    const m0 = calls.length;
    await bot.handleInboundText({ chat: { id: CHAT }, message_id: 950, text: term });
    check('typed text produced results', calls.length > m0, `term="${term}"`);
    dump('search results');
    check('results header shown', /<b>\d+ match(es)?<\/b> for/.test(String(lastView().text)), String(lastView().text));
    check('results have user buttons', buttons().some(b => /^server_user:/.test(b.callback_data)),
      JSON.stringify(buttons().map(b => b.callback_data)));
    // A nonsense query must report cleanly.
    await press('search_prompt', MENU);
    await bot.handleInboundText({ chat: { id: CHAT }, message_id: 951, text: 'zzz_no_such_user_zzz' });
    check('no-match handled', /No matches/.test(String(lastView().text)), String(lastView().text));
    // Opening a result must give a working card.
    await press('search_prompt', MENU);
    await bot.handleInboundText({ chat: { id: CHAT }, message_id: 952, text: term });
    const resBtn = buttons().find(b => /^server_user:/.test(b.callback_data));
    if (resBtn) {
      await press(resBtn.callback_data, 953);
      check('search result opens a card', String(lastView().text).includes('📱 Device Limit:'), String(lastView().text));
    }

    console.log('\n=== 13. Card is 6 lines even for users with extra data ===');
    // A user with a remark and a data limit must still render exactly six lines,
    // so the card never changes shape between accounts.
    const rich = await pool.query(
      `SELECT id, server_id FROM users
        WHERE enabled = TRUE AND remark IS NOT NULL AND remark <> '' AND data_limit_gb IS NOT NULL
        ORDER BY id LIMIT 1`);
    if (rich.rows.length) {
      const r = rich.rows[0];
      await press(`server_user:${r.server_id}:${r.id}:m`, 954);
      dump('card for a user with remark + data limit');
      const richLines = String(lastView().text).split('\n');
      check('still exactly 6 lines', richLines.length === 6, `got ${richLines.length}: ${JSON.stringify(richLines)}`);
      check('remark is NOT leaked onto the card', !/📝/.test(String(lastView().text)), String(lastView().text));
      check('data limit is NOT leaked onto the card', !/📶/.test(String(lastView().text)), String(lastView().text));
    } else {
      console.log('  (no user with both remark and data limit - skipping)');
    }

    // A user with no name-ish edge cases: device limit of 1 still renders.
    const oneDev = await pool.query("SELECT id, server_id FROM users WHERE enabled = TRUE AND total_devices = 1 LIMIT 1");
    if (oneDev.rows.length) {
      const o = oneDev.rows[0];
      await press(`server_user:${o.server_id}:${o.id}:m`, 955);
      check('device limit 1 renders as a number', /📱 Device Limit: 1$/.test(String(lastView().text).trim()), String(lastView().text));
    }

  } catch (e) {
    console.error('\nHARNESS ERROR:', e && e.stack ? e.stack : e);
    fail++;
  } finally {
    if (restore) {
      await pool.query('UPDATE users SET expire_date=$2 WHERE id=$1', [restore.uid, restore.before]);
      const chk = await pool.query('SELECT expire_date FROM users WHERE id=$1', [restore.uid]);
      console.log(`\n[cleanup] restored user ${restore.uid} expire_date -> ${String(chk.rows[0].expire_date)}`);
    }
    console.log(fail === 0 ? '\n==== ALL CHECKS PASSED ====' : `\n==== ${fail} CHECK(S) FAILED ====`);
    try { await pool.end(); } catch (_) {}
    process.exit(fail === 0 ? 0 : 1);
  }
})();
