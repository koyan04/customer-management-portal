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
    if (/^\s*-\s+/.test(line)) {
      if (currentBlock.length > 0) blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) blocks.push(currentBlock);

  const processedBlocks = blocks.map(block => {
    while (block.length > 0 && /^\s*$/.test(block[block.length - 1])) block.pop();

    let type = '';
    let network = '';
    let port = 0;
    let hasReality = false;
    let hasSni = false;
    let servernameVal = '';
    let hasAlpn = false;
    let hasSkipCert = false;

    for (const l of block) {
      const tm = l.match(/^\s+type:\s*([a-zA-Z0-9-]+)/);
      if (tm) type = tm[1].trim();
      const nm = l.match(/^\s+network:\s*([a-zA-Z0-9-]+)/);
      if (nm) network = nm[1].trim();
      const pm = l.match(/^\s+port:\s*(\d+)/);
      if (pm) port = Number(pm[1]);
      if (/^\s+reality-opts:/.test(l)) hasReality = true;
      if (/^\s+sni:\s*/.test(l)) hasSni = true;
      const snm = l.match(/^\s+servername:\s*["']?([^"'\r\n]+)["']?/);
      if (snm) servernameVal = snm[1].trim();
      if (/^\s+alpn:\s*/.test(l)) hasAlpn = true;
      if (/^\s+skip-cert-verify:\s*/.test(l)) hasSkipCert = true;
    }

    const newLines = [];
    let inXhttpOpts = false;
    let inXhttpHeaders = false;

    for (let i = 0; i < block.length; i++) {
      let l = block[i];
      if (/^\s*$/.test(l)) continue; // avoid blank lines inside proxy blocks

      // CRITICAL: Strip skip-cert-verify if node uses REALITY.
      // In Clash Meta / Mihomo, skip-cert-verify: true interferes with the REALITY TLS fingerprint and handshake verification!
      if (hasReality && /^\s+skip-cert-verify:\s*/.test(l)) {
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
      if (type === 'trojan' && /^\s*alpn:\s*\[.*h2.*\]/.test(l)) {
        l = '    alpn: [http/1.1]';
      }

      // Convert xhttp mode: auto -> packet-up for Mihomo compatibility
      if (network === 'xhttp' && /^\s*mode:\s*auto\s*$/.test(l)) {
        l = l.replace(/mode:\s*auto/, 'mode: packet-up');
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
      if (network === 'xhttp' && !hasAlpn) {
        newLines.push('    alpn: [h2]');
      }
    }

    return newLines;
  });

  const flatProxies = [];
  for (const b of processedBlocks) {
    for (const l of b) flatProxies.push(l);
  }

  content = [...preLines, ...flatProxies, ...postLines].join('\n');

  return content;
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

module.exports = { sanitizeClashYaml, safeDecode };
