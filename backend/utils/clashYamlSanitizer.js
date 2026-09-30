/**
 * Sanitizes Clash / Mihomo YAML configuration strings to ensure valid syntax.
 * Prevents errors such as:
 * "proxy group: `use` or `proxies` missing"
 * by ensuring proxies is not empty/null and eliminating empty url-test/fallback/load-balance groups.
 */
function sanitizeClashYaml(content) {
  if (!content || typeof content !== 'string') return content;

  // 1. Ensure top-level proxies: is formatted correctly:
  // - If it contains proxy items (e.g. "  - name: ..."), it MUST be plain "proxies:" (never "proxies: []")
  // - If it is empty, null, or has no proxy items, it MUST be "proxies: []" to prevent parser errors
  const lines = content.split('\n');
  let proxiesLineIdx = -1;
  let hasProxyItems = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^proxies:\s*(?:null|\[\])?\s*$/.test(line)) {
      proxiesLineIdx = i;
      // Scan subsequent lines until next top-level key or EOF to check for list items
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (/^[a-zA-Z0-9_-]+:/.test(nextLine)) {
          // Reached next top-level key (e.g. proxy-groups:)
          break;
        }
        if (/^\s*-\s+/.test(nextLine)) {
          hasProxyItems = true;
          break;
        }
      }
      break;
    }
  }

  if (proxiesLineIdx !== -1) {
    if (hasProxyItems) {
      lines[proxiesLineIdx] = 'proxies:';
    } else {
      lines[proxiesLineIdx] = 'proxies: []';
    }
  } else {
    // If top-level proxies: is missing completely, insert "proxies: []" before proxy-groups:
    const pgIdx = lines.findIndex(l => /^proxy-groups:\s*$/.test(l));
    if (pgIdx !== -1) {
      lines.splice(pgIdx, 0, 'proxies: []', '');
    }
  }

  content = lines.join('\n');

  // 2. Identify proxy-groups with empty proxies (e.g. url-test, fallback, load-balance)
  const groupStartIndices = [];
  let inProxyGroups = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^proxy-groups:\s*$/.test(line)) {
      inProxyGroups = true;
      continue;
    }
    if (/^rules:\s*$/.test(line)) {
      inProxyGroups = false;
      continue;
    }
    if (inProxyGroups && /^\s*- name:/.test(line)) {
      groupStartIndices.push(i);
    }
  }

  // Parse each group block
  const groupsToRemove = new Set();
  for (let g = 0; g < groupStartIndices.length; g++) {
    const start = groupStartIndices[g];
    const end = g + 1 < groupStartIndices.length ? groupStartIndices[g + 1] : lines.findIndex((l, idx) => idx > start && /^rules:\s*$/.test(l));
    const block = lines.slice(start, end !== -1 ? end : undefined);

    // Check type and proxies
    const nameMatch = block[0].match(/name:\s*["']?([^"'\r\n]+)["']?/);
    const typeLine = block.find(l => /^\s*type:/.test(l));
    const typeMatch = typeLine ? typeLine.match(/type:\s*([a-zA-Z0-9-]+)/) : null;
    const type = typeMatch ? typeMatch[1].trim() : '';

    const proxiesLine = block.find(l => /^\s*proxies:\s*(?:null|\[\])?\s*$/.test(l));
    const proxiesIdx = proxiesLine ? block.indexOf(proxiesLine) : -1;
    let hasProxyItems = false;
    if (proxiesIdx !== -1 && !/null|\[\]/.test(proxiesLine)) {
      for (let j = proxiesIdx + 1; j < block.length; j++) {
        if (/^\s+-\s+/.test(block[j])) {
          hasProxyItems = true;
          break;
        }
      }
    }

    // Clash requires url-test, fallback, load-balance to have proxies or use
    if (['url-test', 'fallback', 'load-balance'].includes(type) && !hasProxyItems) {
      if (nameMatch) {
        groupsToRemove.add(nameMatch[1].trim());
      }
    }
  }

  if (groupsToRemove.size > 0) {
    const newLines = [];
    let skippingGroup = false;
    inProxyGroups = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^proxy-groups:\s*$/.test(line)) {
        inProxyGroups = true;
        newLines.push(line);
        continue;
      }
      if (/^rules:\s*$/.test(line)) {
        inProxyGroups = false;
        skippingGroup = false;
        newLines.push(line);
        continue;
      }

      if (inProxyGroups) {
        if (/^\s*- name:/.test(line)) {
          const nameMatch = line.match(/name:\s*["']?([^"'\r\n]+)["']?/);
          const gName = nameMatch ? nameMatch[1].trim() : '';
          if (groupsToRemove.has(gName)) {
            skippingGroup = true;
            continue;
          } else {
            skippingGroup = false;
          }
        }

        if (skippingGroup) {
          continue;
        }

        // Check if this line is a proxy reference to one of the removed groups
        const refMatch = line.match(/^\s+-\s+(.+)$/);
        if (refMatch) {
          const target = refMatch[1].trim().replace(/^["']|["']$/g, '');
          if (groupsToRemove.has(target)) {
            continue; // Skip referencing removed group
          }
        }
      }

      newLines.push(line);
    }

    content = newLines.join('\n');
  }

  // Ensure select group has at least DIRECT if all proxies were removed
  content = content.replace(/((\s*)-\s*name:\s*[^\n]+\n\s+type:\s*select\n\s+proxies:)(\s*(?:null|\[\])?\s*\n\s*(?:-\s*name:|rules:|$))/g, '$1\n$2  - DIRECT\n');

  // 3. Clean up rules section: Clash/Mihomo rules are comma-delimited strings where target group names
  // must NOT have enclosing quotes (e.g. "- DOMAIN-SUFFIX,netflix.com,🚀 VChannel-Premium", not "...\"🚀 VChannel-Premium\"")
  const ruleLines = content.split('\n');
  let inRules = false;
  for (let i = 0; i < ruleLines.length; i++) {
    const line = ruleLines[i];
    if (/^rules:\s*$/.test(line)) {
      inRules = true;
      continue;
    }
    if (inRules) {
      if (/^[a-zA-Z0-9_-]+:/.test(line) && !/^\s*-/.test(line)) {
        inRules = false;
        continue;
      }
      if (/^\s*-\s+/.test(line)) {
        ruleLines[i] = line.replace(/,"([^"]+)"/g, ',$1').replace(/,'([^']+)'/g, ',$1');
      }
    }
  }
  content = ruleLines.join('\n');

  // 4. Heal Trojan and VLESS proxy nodes:
  // - Trojan: decode double/triple percent-encoded passwords, force alpn to [http/1.1] for WS, add skip-cert-verify: true
  // - VLESS REALITY: ensure sni is present if servername is present, quote public-key & short-id,
  //   STRIP skip-cert-verify (breaks REALITY validation in Clash Mi / Mihomo)
  // - VLESS XHTTP: force mode: packet-up, force alpn: [h2], remove invalid headers block in xhttp-opts
  const allLines = content.split('\n');
  const pIdx = allLines.findIndex(l => /^proxies:\s*$/.test(l));
  if (pIdx === -1) return content;

  let endIdx = allLines.findIndex((l, idx) => idx > pIdx && /^[a-zA-Z0-9_-]+:/.test(l));
  if (endIdx === -1) endIdx = allLines.length;

  const preLines = allLines.slice(0, pIdx + 1);
  const proxyLines = allLines.slice(pIdx + 1, endIdx);
  const postLines = allLines.slice(endIdx);

  const blocks = [];
  let currentBlock = [];

  for (const line of proxyLines) {
    // A new proxy starts only at the canonical 2-space `- name:` indent. Splitting on
    // ANY indented `- ` previously mis-detected block-sequence items (e.g. alpn's
    // "- h2") as the start of a new proxy, splitting one node into fragments and
    // losing the type/network context needed to heal it.
    if (/^ {2}-\s+/.test(line)) {
      if (currentBlock.length > 0) blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  const processedBlocks = blocks.map(block => {
    while (block.length > 0 && /^\s*$/.test(block[block.length - 1])) block.pop();

    // ── Pre-pass: reclaim orphaned sequence items ────────────────────────
    // A Clash proxy is a mapping, so a list item at the proxy-field indent
    // (4 spaces) is ALWAYS invalid there. The generator writes alpn as a block
    // sequence whose items sit at that same 4-space indent, and once a sibling
    // key (e.g. `sni:`) is interleaved between the key and its items the items
    // are orphaned -- they can no longer be re-associated by adjacency.
    // Collect them here so they can be folded back into alpn below.
    const orphanAlpnItems = [];
    const orphanIdx = new Set();
    const orphanValues = new Map();
    for (let i = 0; i < block.length; i++) {
      if (/^ {4}-\s+/.test(block[i])) {
        const m = block[i].match(/^ {4}-\s*(.+?)\s*$/);
        if (m) {
          const v = m[1].trim().replace(/^["']|["']$/g, '');
          orphanAlpnItems.push(v);
          orphanValues.set(i, v);
        }
        orphanIdx.add(i);
      }
    }
    // Track whether a bare `alpn:` key already absorbed the orphans, so the
    // trailing reclaim does not emit a second alpn key.
    let absorbedOrphans = false;
    // True once we emitted a normalized (inline) alpn for this proxy, so the
    // trailing vless/xhttp injection does not add a second alpn key.
    let hasInlineAlpn = false;

    let type = '';
    let network = '';
    let port = 0;
    let serverVal = '';
    let hasReality = false;
    let hasSni = false;
    let servernameVal = '';
    let hasXhttpOpts = false;
    let xhttpHostVal = '';
    let xhttpPathVal = '/';
    // Only an INLINE alpn value counts as present. A bare `alpn:` key means the
    // generator emitted a block sequence (items on following lines), which is
    // normalized below -- treating it as "already present" previously left the
    // orphaned "- item" lines unindented and produced structurally invalid YAML.
    let hasAlpn = false;
    let hasSkipCert = false;
    let hasMlkem = false;

    for (let bi = 0; bi < block.length; bi++) {
      if (orphanIdx.has(bi)) continue; // orphaned list items are not proxy fields
      const l = block[bi];
      const tm = l.match(/^\s+type:\s*([a-zA-Z0-9-]+)/);
      if (tm) type = tm[1].trim();
      const nm = l.match(/^\s+network:\s*([a-zA-Z0-9-]+)/);
      if (nm) network = nm[1].trim();
      const pm = l.match(/^\s+port:\s*(\d+)/);
      if (pm) port = Number(pm[1]);
      const srvM = l.match(/^\s+server:\s*["']?([^"'\r\n]+)["']?/);
      if (srvM) serverVal = srvM[1].trim();
      if (/^\s+reality-opts:/.test(l)) hasReality = true;
      if (/^\s+xhttp-opts:/.test(l)) hasXhttpOpts = true;
      if (/^\s+support-x25519mlkem768:\s*/.test(l)) hasMlkem = true;
      if (/^\s+sni:\s*/.test(l)) hasSni = true;
      const snm = l.match(/^\s+servername:\s*["']?([^"'\r\n]+)["']?/);
      if (snm) servernameVal = snm[1].trim();
      if (/^\s+alpn:\s*\[/.test(l)) hasAlpn = true;
      if (/^\s+skip-cert-verify:\s*/.test(l)) hasSkipCert = true;
    }
    // Orphaned items are themselves evidence that an alpn list was intended.
    if (orphanAlpnItems.length) hasAlpn = false;

    // Normalize redirect-causing SNIs for REALITY (e.g. yt.be, android.com return 301/302 redirects on Google servers,
    // which causes Mihomo's xhttp client to fail REALITY authentication)
    if (hasReality && ['yt.be', 'android.com', 'ai.android'].includes(servernameVal.toLowerCase())) {
      servernameVal = 'www.goo.gl';
    }

    const newLines = [];
    let inXhttpOpts = false;
    let inXhttpHeaders = false;

    for (let i = 0; i < block.length; i++) {
      let l = block[i];

      // Drop orphaned proxy-depth list items here; they are folded into alpn at
      // the end of this block (see orphanAlpnItems handling below).
      if (orphanIdx.has(i)) continue;

      // Normalize a block-style `alpn:` sequence into a single inline list.
      // The generator emits alpn as a block sequence. Two shapes occur:
      //   1) as a direct proxy field at 4-space indent, with items ALSO at 4-space
      //      -> items become siblings of the proxy, a hard YAML parse error.
      //   2) as the proxy's FIRST key on the opening line ("  - alpn:"), items at
      //      4-space -> this parses, but we normalize for consistency and so the
      //      trojan/xhttp rewrites below see a uniform shape.
      // Deeper alpn (6+ spaces) belongs to reality-opts / xhttp-opts / ws-opts and
      // is left untouched -- rewriting it would detach its sibling keys.
      // Accepts an optional leading "- " sequence marker at either proxy depth.
      const alpnKeyMatch = l.match(/^(?: {2}- | {4})alpn:\s*$/);
      if (alpnKeyMatch) {
        const isOpening = /^ {2}- /.test(l);
        const items = [];
        let j = i + 1;
        // Items may be adjacent OR orphaned/interleaved with a sibling key (that is
        // precisely the corruption being repaired), so accept both, in order.
        for (; j < block.length; j++) {
          if (orphanIdx.has(j)) {
            items.push(orphanValues.get(j));
            continue;
          }
          const itemMatch = block[j].match(/^\s*-\s*(.+?)\s*$/);
          if (!itemMatch) break;
          items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
        }
        if (items.length) {
          // Apply the type-specific ALPN policy HERE, at emission, because this
          // branch `continue`s and the later per-line Trojan rewrite never sees
          // the normalized line. Trojan-over-WebSocket must not negotiate h2
          // (Clash Mi fails the handshake), so force http/1.1.
          const finalItems = (type === 'trojan') ? ['http/1.1'] : items;
          // A 2-space alpn is the block's opening "- alpn:" line, so it must keep
          // the "- " sequence marker; a 4-space one is a plain sibling key.
          const emitted = isOpening
            ? `  - alpn: [${finalItems.join(', ')}]`
            : `    alpn: [${finalItems.join(', ')}]`;
          newLines.push(emitted);
          hasAlpn = true;
          hasInlineAlpn = true;
          absorbedOrphans = true;
          i = j - 1; // consume the consumed items
          continue;
        }
        // Bare `alpn:` with no items: drop it rather than emit a null list.
        hasAlpn = false;
        continue;
      }

      if (/^\s*$/.test(l)) continue; // avoid blank lines inside proxy blocks

      // CRITICAL: Strip skip-cert-verify if node uses REALITY.
      // In Clash Meta / Mihomo, skip-cert-verify: true interferes with the REALITY TLS fingerprint and handshake verification!
      if (hasReality && /^\s+skip-cert-verify:\s*/.test(l)) {
        continue;
      }

      // Track reality-opts and inject support-x25519mlkem768: true if missing
      if (/^\s+reality-opts:/.test(l)) {
        newLines.push(l);
        if (!hasMlkem) {
          newLines.push('      support-x25519mlkem768: true');
          hasMlkem = true;
        }
        continue;
      }

      // Track xhttp-opts
      if (/^\s+xhttp-opts:/.test(l)) {
        inXhttpOpts = true;
        inXhttpHeaders = false;
        newLines.push(l);
        continue;
      }

      if (inXhttpOpts) {
        if (/^\s{4}[a-zA-Z0-9_-]+:/.test(l)) {
          // Reached another top-level proxy field (4 spaces indentation)
          inXhttpOpts = false;
          inXhttpHeaders = false;
        } else if (/^\s{6}headers:\s*$/.test(l)) {
          inXhttpHeaders = true;
          continue; // Strip headers: line from xhttp-opts
        } else if (inXhttpHeaders) {
          if (/^\s{8,}/.test(l)) {
            continue; // Strip headers properties (e.g. Host: ...)
          } else {
            inXhttpHeaders = false;
          }
        }
      }

      // Decode Trojan percent-encoded password
      const passMatch = l.match(/^(\s*password:\s*["']?)([^"'\r\n]+)(["']?)/);
      if (passMatch && /%[0-9a-fA-F]{2}/.test(passMatch[2])) {
        const clean = safeDecode(passMatch[2]);
        l = `${passMatch[1]}${clean}${passMatch[3]}`;
      }

      // Fix Trojan WS ALPN: h2 -> http/1.1
      // Anchored to proxy-field depth (4 spaces) or the opening "- alpn:" line
      // (2 spaces) so we never rewrite an alpn nested inside a sub-block.
      if (type === 'trojan' && /^ {4}alpn:\s*\[.*h2.*\]/.test(l)) {
        l = '    alpn: [http/1.1]';
      } else if (type === 'trojan' && /^ {2}- alpn:\s*\[.*h2.*\]/.test(l)) {
        l = '  - alpn: [http/1.1]';
      }

      // Ensure xhttp mode is auto for streaming compatibility with Xray (packet-up causes packet fragmentation failures)
      if (network === 'xhttp' && /^\s*mode:\s*packet-up\s*$/.test(l)) {
        l = l.replace(/mode:\s*packet-up/, 'mode: auto');
      }

      // Strip x-padding-bytes from xhttp-opts (only used in packet-up)
      if (network === 'xhttp' && /^\s*x-padding-bytes:\s*/.test(l)) {
        continue;
      }

      // Rewrite servername / sni if it points to redirecting domains on REALITY
      if (hasReality) {
        if (/^\s+servername:\s*["']?(?:yt\.be|android\.com|ai\.android)["']?/.test(l)) {
          l = '    servername: www.goo.gl';
        }
        if (/^\s+sni:\s*["']?(?:yt\.be|android\.com|ai\.android)["']?/.test(l)) {
          l = '    sni: www.goo.gl';
        }
      }

      // Fix reality-opts: ensure public-key and short-id are quoted
      const pkMatch = l.match(/^(\s*public-key:\s*)([^"'\r\n]+)$/);
      if (pkMatch && !/^["'].*["']$/.test(pkMatch[2].trim())) {
        l = `${pkMatch[1]}"${pkMatch[2].trim()}"`;
      }
      const sidMatch = l.match(/^(\s*short-id:\s*)([^"'\r\n]+)$/);
      if (sidMatch && !/^["'].*["']$/.test(sidMatch[2].trim())) {
        l = `${sidMatch[1]}"${sidMatch[2].trim()}"`;
      }

      newLines.push(l);
    }

    // Add missing required fields before the end of the block
    if (type === 'trojan') {
      if (!hasSkipCert && (port === 80 || network === 'ws')) {
        newLines.push('    skip-cert-verify: true');
      }
    } else if (type === 'vless') {
      if (servernameVal && !hasSni) {
        newLines.push(`    sni: ${servernameVal}`);
      }
      if (network === 'xhttp' && !hasAlpn && !hasInlineAlpn) {
        newLines.push('    alpn: [h2]');
      }
    }

    // Ensure an xhttp node actually carries xhttp-opts. Some generated profiles
    // declare `network: xhttp` but omit the block entirely, which leaves Clash /
    // Mihomo with no mode, path, or host for the transport. Rebuild a minimal one
    // from the node's own server/servername so the profile is usable.
    if (network === 'xhttp' && !hasXhttpOpts) {
      const xhttpHost = xhttpHostVal || servernameVal || serverVal || 'www.goo.gl';
      newLines.push('    xhttp-opts:');
      newLines.push(`      host: ${xhttpHost}`);
      newLines.push('      mode: auto');
      newLines.push(`      path: ${xhttpPathVal}`);
    }

    // Reclaim orphans that no bare `alpn:` key absorbed (e.g. the alpn key itself
    // was missing, leaving only stray items). Emit them as an alpn list rather than
    // dropping data, and collapse any earlier alpn so we never emit a duplicate key.
    if (orphanAlpnItems.length && !absorbedOrphans) {
      for (let k = newLines.length - 1; k >= 0; k--) {
        if (/^ {4}alpn:\s*\[/.test(newLines[k])) newLines.splice(k, 1);
      }
      const finalItems = (type === 'trojan') ? ['http/1.1'] : orphanAlpnItems;
      newLines.push(`    alpn: [${finalItems.join(', ')}]`);
    }

    return newLines;
  });

  const flatProxies = [];
  for (const b of processedBlocks) {
    for (const l of b) flatProxies.push(l);
  }

  content = [...preLines, ...flatProxies, ...postLines].join('\n');

  // 5. De-duplicate proxy names within the profile.
  // Clash / Mihomo resolve proxy-group members BY NAME, so two proxies sharing a
  // name make the first one unreachable: the second silently shadows it and every
  // group reference points at the winner. The generator can emit a name collision
  // when different protocols (e.g. shadowsocks "SG01" and vless "SG01") are both
  // present. Rename the later duplicates and repoint every group reference.
  content = dedupeProxyNames(content);

  return content;
}

/**
 * Ensure every proxy in the `proxies:` block has a unique name, updating all
 * proxy-group member references to match. Returns the content unchanged when
 * there is nothing to fix.
 */
function dedupeProxyNames(content) {
  const lines = content.split('\n');
  const pIdx = lines.findIndex(l => /^proxies:\s*$/.test(l));
  if (pIdx === -1) return content;

  let endIdx = lines.findIndex((l, idx) => idx > pIdx && /^[a-zA-Z0-9_-]+:/.test(l));
  if (endIdx === -1) endIdx = lines.length;

  // Collect names in order; a proxy name may sit on the opening "- name: ..." line
  // or on a following "    name: ..." line when the block starts with another key.
  const nameLineIdx = [];
  const names = [];
  let currentName = null;
  let currentNameIdx = -1;

  for (let i = pIdx + 1; i < endIdx; i++) {
    const l = lines[i];
    if (/^ {2}-\s+/.test(l)) {
      if (currentName) { nameLineIdx.push(currentNameIdx); names.push(currentName); }
      currentName = null; currentNameIdx = -1;
      const m = l.match(/^ {2}-\s+name:\s*(.+?)\s*$/);
      // Strip any existing quotes: we re-quote on write, so keeping them would
      // produce doubled quotes such as - name: ""node"".
      if (m) { currentName = m[1].trim().replace(/^["']|["']$/g, ''); currentNameIdx = i; }
    } else {
      const m = l.match(/^ {4}name:\s*(.+?)\s*$/);
      if (m && !currentName) { currentName = m[1].trim().replace(/^["']|["']$/g, ''); currentNameIdx = i; }
    }
  }
  if (currentName) { nameLineIdx.push(currentNameIdx); names.push(currentName); }
  if (names.length < 2) return content;

  // Assign a "(n)" suffix to the 2nd+ occurrence of any duplicated name.
  const seen = new Map();
  const assigned = [];
  for (const n of names) {
    const c = (seen.get(n) || 0) + 1;
    seen.set(n, c);
    assigned.push(c === 1 ? n : `${n} (${c})`);
  }
  // Nothing to do when every name is already unique.
  if (assigned.every((n, i) => n === names[i])) return content;

  // Rewrite each proxy's name line to its assigned (possibly suffixed) value.
  assigned.forEach((newName, idx) => {
    const li = nameLineIdx[idx];
    const l = lines[li];
    if (/^ {2}-\s+name:/.test(l)) {
      lines[li] = l.replace(/^ {2}-\s+name:\s*.+$/, `  - name: "${newName}"`);
    } else {
      lines[li] = l.replace(/^ {4}name:\s*.+$/, `    name: "${newName}"`);
    }
  });

  // Build old->new lookup for every duplicate occurrence. Group references are
  // ambiguous for a duplicated name (they cannot distinguish the two), so point
  // each reference at the renamed occurrence in order of appearance.
  const occurrences = new Map(); // oldName -> [newName, ...]
  names.forEach((oldName, idx) => {
    if (!occurrences.has(oldName)) occurrences.set(oldName, []);
    occurrences.get(oldName).push(assigned[idx]);
  });

  // Repoint group member references.
  // A reference to a duplicated name is ambiguous on its own, so resolve it by
  // position: the Nth reference within a group maps to the Nth occurrence of that
  // proxy. The cursor is per-group -- if it were shared globally, the first group
  // would consume every occurrence slot and later groups would collapse onto the
  // same renamed node, silently dropping the others from those groups.
  const gStart = lines.findIndex(l => /^proxy-groups:\s*$/.test(l));
  if (gStart !== -1) {
    let gEnd = lines.findIndex((l, i) => i > gStart && /^rules:\s*$/.test(l));
    if (gEnd === -1) gEnd = lines.length;
    let cursor = new Map();
    for (let i = gStart; i < gEnd; i++) {
      // A new group begins at "- name:"; start its reference numbering over.
      if (/^ {2}-\s+name:/.test(lines[i])) {
        cursor = new Map();
        continue;
      }
      const rm = lines[i].match(/^(\s+-\s+)(.+?)(\s*)$/);
      if (!rm) continue;
      const unquoted = rm[2].trim().replace(/^["']|["']$/g, '');
      const list = occurrences.get(unquoted);
      if (!list || list.length < 2) continue; // unique name: nothing to repoint
      const used = cursor.get(unquoted) || 0;
      const target = list[Math.min(used, list.length - 1)];
      cursor.set(unquoted, used + 1);
      if (target !== unquoted) {
        lines[i] = `${rm[1]}"${target}"${rm[3]}`;
      }
    }
  }

  return lines.join('\n');
}

function safeDecode(str) {
  if (!str) return str;
  let decoded = String(str);
  while (/%[0-9a-fA-F]{2}/.test(decoded)) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch (_) {
      break;
    }
  }
  return decoded;
}

module.exports = { sanitizeClashYaml, safeDecode, dedupeProxyNames };
