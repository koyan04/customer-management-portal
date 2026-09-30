// Tests for validateClashYaml() - the upload gate that must never let a
// structurally broken profile reach disk.
const path = require('path');
const { sanitizeClashYaml, validateClashYaml } = require(path.join(__dirname, '..', 'utils', 'clashYamlSanitizer.js'));

let fails = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`); fails++; }
};

const wrap = (proxiesBody) => `mixed-port: 7890
allow-lan: true
mode: rule

proxies:
${proxiesBody}

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - n1

rules:
  - MATCH,PROXY
`;

console.log('\n== rejects malformed sequence depth ==');
const bad = wrap(`  - name: n1
    type: trojan
    alpn:
    - h2
    - http/1.1
    server: a.example.com
    port: 80`);
const vBad = validateClashYaml(bad);
check('bare-key sequence is rejected', vBad.ok === false, vBad.errors);
check('error mentions proxy depth', vBad.errors.some(e => /proxy depth/.test(e)), vBad.errors);

console.log('\n== accepts correct inline form ==');
const good = wrap(`  - name: n1
    type: trojan
    alpn: [http/1.1]
    server: a.example.com
    port: 80`);
const vGood = validateClashYaml(good);
check('inline alpn accepted', vGood.ok === true, vGood.errors);

console.log('\n== rejects duplicate proxy names ==');
const dup = wrap(`  - name: same
    type: vless
    server: a.example.com
    port: 443
  - name: same
    type: trojan
    server: b.example.com
    port: 80`);
const vDup = validateClashYaml(dup);
check('duplicate names rejected', vDup.ok === false, vDup.errors);
check('error names the duplicate', vDup.errors.some(e => /duplicate proxy name/.test(e)), vDup.errors);

console.log('\n== sanitize then validate round trip ==');
// sanitizeClashYaml should repair the malformed file into an acceptable one.
const fixed = sanitizeClashYaml(bad);
const vFixed = validateClashYaml(fixed);
check('sanitized output passes validation', vFixed.ok === true, vFixed.errors);
check('repair collapsed alpn to inline', /alpn: \[/.test(fixed) && !/^\s*alpn:\s*$/m.test(fixed));

console.log('\n== sanitize repairs duplicates too ==');
const fixedDup = sanitizeClashYaml(dup);
const vFixedDup = validateClashYaml(fixedDup);
check('deduped output passes validation', vFixedDup.ok === true, vFixedDup.errors);
// Count only the proxy block (between "proxies:" and the next top-level key),
// since group members are also list items and would otherwise be counted.
const proxiesBlock = fixedDup.slice(
  fixedDup.indexOf('proxies:'),
  fixedDup.indexOf('\nproxy-groups:')
);
const nameCount = (proxiesBlock.match(/^ {2}- name:/gm) || []).length;
check('both proxies still present', nameCount === 2, nameCount);
check('second proxy was renamed', /- name: "same \(2\)"/.test(fixedDup), fixedDup);

console.log('\n== rejects quoted rule targets ==');
const quoted = good.replace('- MATCH,PROXY', '- DOMAIN-SUFFIX,x.com,"PROXY"');
const vQuoted = validateClashYaml(quoted);
check('quoted rule target rejected', vQuoted.ok === false, vQuoted.errors);

console.log('\n== warns (not errors) on empty url-test group ==');
const emptyGroup = good.replace(`  - name: "PROXY"
    type: select
    proxies:
      - n1`, `  - name: "PROXY"
    type: select
    proxies:
      - n1
  - name: "AUTO"
    type: url-test
    proxies:`);
const vEmpty = validateClashYaml(emptyGroup);
check('empty group is a warning not an error', vEmpty.ok === true, vEmpty.errors);
check('warning was raised', vEmpty.warnings.length > 0, vEmpty.warnings);

console.log('\n== input guards ==');
check('null content rejected', validateClashYaml(null).ok === false);
check('empty string rejected', validateClashYaml('').ok === false);
check('non-string rejected', validateClashYaml(123).ok === false);

console.log('\n== legal sequences OUTSIDE proxies are not flagged ==');
// fake-ip-filter / ipcidr / nameserver legitimately use 4-space and 6-space
// sequences. The proxy-depth check must be scoped to the proxies: block only.
const outside = `mixed-port: 7890
dns:
  enable: true
  fake-ip-filter:
    - "*.lan"
    - "*.local"
    - localhost.ptlogin2.qq.com
  ipcidr:
    - 240.0.0.0/4
    - 0.0.0.0/32

proxies:
  - name: n1
    type: vless
    server: a.example.com
    port: 443
    alpn: [h2, http/1.1]

proxy-groups:
  - name: P
    type: select
    proxies:
      - n1

rules:
  - MATCH,P
`;
const vOutside = validateClashYaml(outside);
check('dns sequences not flagged as errors', vOutside.ok === true, vOutside.errors);
check('specifically no proxy-depth errors', !vOutside.errors.some(e => /proxy depth/.test(e)), vOutside.errors);

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}\n`);
process.exit(fails === 0 ? 0 : 1);
