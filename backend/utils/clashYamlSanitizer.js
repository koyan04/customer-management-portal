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
  // - VLESS REALITY: ensure sni is present if servername is present, quote public-key & short-id
  const pLines = content.split('\n');
  let inProxies = false;
  let currentProxyType = '';
  let currentProxyNetwork = '';
  let currentProxyHasSni = false;
  let currentProxyHasServername = false;
  let currentProxyServernameVal = '';
  let currentProxyHasSkipCert = false;
  let currentProxyStartIndex = -1;
  let currentProxyPort = 0;

  function flushCurrentProxy(endIdx) {
    let added = 0;
    if (currentProxyType === 'trojan') {
      if (!currentProxyHasSkipCert && (currentProxyPort === 80 || currentProxyNetwork === 'ws')) {
        pLines.splice(endIdx, 0, '    skip-cert-verify: true');
        added++;
      }
    } else if (currentProxyType === 'vless') {
      if (currentProxyHasServername && !currentProxyHasSni && currentProxyServernameVal) {
        pLines.splice(endIdx, 0, `    sni: ${currentProxyServernameVal}`);
        added++;
      }
    }
    return added;
  }

  for (let i = 0; i < pLines.length; i++) {
    const line = pLines[i];
    if (/^proxies:\s*$/.test(line)) {
      inProxies = true;
      continue;
    }
    if (inProxies) {
      if (/^[a-zA-Z0-9_-]+:/.test(line) && !/^\s*-/.test(line)) {
        flushCurrentProxy(i);
        inProxies = false;
        continue;
      }

      if (/^\s*-\s+/.test(line)) {
        if (currentProxyStartIndex !== -1) {
          const inserted = flushCurrentProxy(i);
          i += inserted;
        }
        currentProxyStartIndex = i;
        currentProxyType = '';
        currentProxyNetwork = '';
        currentProxyHasSni = false;
        currentProxyHasServername = false;
        currentProxyServernameVal = '';
        currentProxyHasSkipCert = false;
        currentProxyPort = 0;
      }

      const typeMatch = line.match(/^\s+type:\s*([a-zA-Z0-9-]+)/);
      if (typeMatch) currentProxyType = typeMatch[1].trim();

      const netMatch = line.match(/^\s+network:\s*([a-zA-Z0-9-]+)/);
      if (netMatch) currentProxyNetwork = netMatch[1].trim();

      const portMatch = line.match(/^\s+port:\s*(\d+)/);
      if (portMatch) currentProxyPort = Number(portMatch[1]);

      if (/^\s+sni:\s*/.test(line)) currentProxyHasSni = true;

      const snMatch = line.match(/^\s+servername:\s*["']?([^"'\r\n]+)["']?/);
      if (snMatch) {
        currentProxyHasServername = true;
        currentProxyServernameVal = snMatch[1].trim();
      }

      if (/^\s+skip-cert-verify:\s*/.test(line)) currentProxyHasSkipCert = true;

      // Fix percent-encoded Trojan password
      const passMatch = line.match(/^(\s*password:\s*["']?)([^"'\r\n]+)(["']?)/);
      if (passMatch && /%[0-9a-fA-F]{2}/.test(passMatch[2])) {
        const clean = safeDecode(passMatch[2]);
        pLines[i] = `${passMatch[1]}${clean}${passMatch[3]}`;
      }

      // Fix Trojan WS ALPN: h2 -> http/1.1
      if (currentProxyType === 'trojan' && /^\s*alpn:\s*\[.*h2.*\]/.test(line)) {
        pLines[i] = '    alpn: [http/1.1]';
      }

      // Fix reality-opts: ensure public-key and short-id are quoted
      const pkMatch = line.match(/^(\s*public-key:\s*)([^"'\r\n]+)$/);
      if (pkMatch && !/^["'].*["']$/.test(pkMatch[2].trim())) {
        pLines[i] = `${pkMatch[1]}"${pkMatch[2].trim()}"`;
      }
      const sidMatch = line.match(/^(\s*short-id:\s*)([^"'\r\n]+)$/);
      if (sidMatch && !/^["'].*["']$/.test(sidMatch[2].trim())) {
        pLines[i] = `${sidMatch[1]}"${sidMatch[2].trim()}"`;
      }
    }
  }

  content = pLines.join('\n');

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
