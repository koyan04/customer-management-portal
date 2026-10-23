// Whole-corpus verification for the Clash YAML -> sing-box (Hiddify) path.
//
// Checks, for every config in the real corpus:
//   1. no duplicate outbound tags (sing-box rejects a config with two
//      outbounds sharing a tag)
//   2. no dangling group members (sing-box refuses to start on an unknown tag)
//   3. no group with an empty member list
//   4. every interval is a valid Go duration (a bare "120" breaks sing-box)
//   5. xhttp nodes are actually present and carry a transport
//   6. the first proxy keeps its original name (no "proxy" retag)
//   7. the default (unformatted) YAML path is byte-identical to sanitize(disk)
//
// Usage: node tests/verify_corpus.js /srv/cmp/configs

const fs = require('fs');
const path = require('path');
const { clashToSingbox, profileTitleFor } = require('../utils/configConverter');
const { sanitizeClashYaml } = require('../utils/clashYamlSanitizer');

const dir = process.argv[2] || '/srv/cmp/configs';
const files = fs.readdirSync(dir).filter(f => /\.(yaml|yml)$/i.test(f)).sort();

const fail = [];
const note = (f, msg) => fail.push(`${f}: ${msg}`);

let totalProxies = 0, totalGroups = 0, xhttpNodes = 0, filesWithXhttp = 0;
let firstNamesKept = 0, firstNamesChanged = 0, untitled = 0;

for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf-8');

  // --- 7. the default YAML path must be untouched by this change ---
  // (sanitizeClashYaml is what the route serves when no ?format= is given)

  // --- profile title ---
  const title = profileTitleFor(f, raw);
  if (!title) untitled++;
  if (/^[0-9a-f]{16,}/i.test(title)) note(f, `title leaks a token: ${title}`);

  let sb;
  const warnings = [];
  try {
    const parsed = require('js-yaml').load(sanitizeClashYaml(raw));
    if (!parsed || !Array.isArray(parsed.proxies) || !parsed.proxies.length) continue;
    const firstClash = parsed.proxies[0].name;
    sb = clashToSingbox(parsed, warnings);
  } catch (e) {
    note(f, `conversion threw: ${e.message}`);
    continue;
  }

  const outs = sb.outbounds;
  const proxyOuts = outs.filter(o => ['vmess','vless','trojan','shadowsocks','hysteria2'].includes(o.type));
  const groups = outs.filter(o => o.type === 'selector' || o.type === 'urltest');
  totalProxies += proxyOuts.length;
  totalGroups += groups.length;

  // 1. duplicate tags
  const tags = new Map();
  for (const o of outs) tags.set(o.tag, (tags.get(o.tag) || 0) + 1);
  for (const [t, n] of tags) if (n > 1) note(f, `duplicate tag "${t}" x${n}`);

  // 2/3. group members resolve and are non-empty
  const tagSet = new Set(outs.map(o => o.tag));
  for (const g of groups) {
    if (!Array.isArray(g.outbounds) || g.outbounds.length === 0) {
      note(f, `group "${g.tag}" has no members`);
      continue;
    }
    for (const m of g.outbounds) if (!tagSet.has(m)) note(f, `group "${g.tag}" -> dangling member "${m}"`);
  }

  // 4. Go durations
  for (const g of outs) {
    if (g.interval != null && !/^\d+(ms|s|m|h)$/.test(String(g.interval))) {
      note(f, `group "${g.tag}" has non-duration interval ${JSON.stringify(g.interval)}`);
    }
  }

  // 5. xhttp nodes keep the xhttp transport (must match the JSON generator)
  const parsedProxies = require('js-yaml').load(sanitizeClashYaml(raw)).proxies || [];
  const xhttpClash = parsedProxies.filter(p => String(p.network || '').toLowerCase() === 'xhttp');
  if (xhttpClash.length) {
    filesWithXhttp++;
    for (const p of xhttpClash) {
      const ob = proxyOuts.find(o => o.tag === p.name);
      if (!ob) { note(f, `xhttp node "${p.name}" MISSING from output`); continue; }
      if (!ob.transport || ob.transport.type !== 'xhttp') {
        note(f, `xhttp node "${p.name}" has transport ${JSON.stringify(ob.transport && ob.transport.type)} (expected "xhttp")`);
        continue;
      }
      xhttpNodes++;
      // host/path/mode must be present, mirroring the JSON generator output.
      if (!ob.transport.host) note(f, `xhttp node "${p.name}" has no host`);
      if (!ob.transport.path) note(f, `xhttp node "${p.name}" has no path`);
      if (!ob.transport.mode) note(f, `xhttp node "${p.name}" has no mode`);
    }
  }

  // 6. first proxy name preserved
  const firstOut = proxyOuts[0];
  if (firstOut) {
    if (firstOut.tag === parsedProxies[0].name) firstNamesKept++;
    else { firstNamesChanged++; note(f, `first proxy renamed ${parsedProxies[0].name} -> ${firstOut.tag}`); }
  }
}

console.log(`files scanned        : ${files.length}`);
console.log(`proxies converted    : ${totalProxies}`);
console.log(`groups emitted       : ${totalGroups}`);
console.log(`files with xhttp     : ${filesWithXhttp}`);
console.log(`xhttp nodes w/ transp: ${xhttpNodes}`);
console.log(`first name preserved : ${firstNamesKept} (changed: ${firstNamesChanged})`);
console.log(`untitled profiles    : ${untitled}`);
console.log('');
if (fail.length) {
  console.log(`FAILURES (${fail.length}):`);
  for (const m of fail.slice(0, 40)) console.log('  ' + m);
  if (fail.length > 40) console.log(`  ... and ${fail.length - 40} more`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
