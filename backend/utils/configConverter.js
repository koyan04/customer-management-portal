/**
 * configConverter.js — Clash YAML <-> sing-box JSON conversion.
 *
 * Two distinct schemas live in the config directory and this is the bridge
 * between them:
 *
 *   .yaml / .yml  ->  Clash config     (proxies:, proxy-groups:, rules:)
 *   .json         ->  sing-box config  (outbounds: [{ type, tag, server, ... }])
 *
 * These are NOT structurally isomorphic, so the conversion is semantic: each
 * Clash proxy is mapped onto the sing-box outbound shape the key server already
 * knows how to serve (see routes/keyserver.js `outboundToURI` /
 * `singboxToV2RayOutbound`, which read exactly the fields produced here).
 *
 * Round-tripping is intentionally lossy for things that have no counterpart
 * (Clash rule-providers, tun/dns sections on the JSON side, etc). Anything that
 * cannot be represented is reported in `warnings` rather than silently dropped,
 * so the UI can tell the operator what will not survive the conversion.
 */

const yaml = require('js-yaml');

// Protocols the key server can serve as proxy URIs. Anything else is a
// non-proxy entry (DIRECT, REJECT, dns, ...) and is dropped on conversion.
const PROXY_TYPES = ['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2'];

// Clash -> sing-box transport naming. `network` in Clash is the transport
// (ws / grpc / http / h2 / xhttp), not the security layer; TLS is separate.
const CLASH_NETWORKS = new Set(['ws', 'grpc', 'h2', 'http', 'tcp', 'xhttp']);

// `xhttp` (Xray's "SplitHTTP") is passed through with its own name.
//
// An earlier version mapped xhttp onto the plain `http` transport on the
// assumption that sing-box has no xhttp support. That was wrong for this
// system: the portal's own JSON generator (frontend/src/pages/
// JsonGeneratorPage.jsx, convertNodeToSingbox) already emits
// `transport: { type: 'xhttp', host, path, mode, extra }`, and the 82 saved
// .json profiles on the server contain 84 such outbounds. Those files are the
// format customers already use successfully, so the YAML -> JSON conversion
// must reproduce exactly the same shape rather than invent a substitute.
//
// The advanced xhttp knobs live in different places in each dialect:
//   - sing-box / portal JSON: mode + extra{...} directly on the transport
//   - Clash YAML:             mode + max-body-size / padding-bytes /
//                              user-agent / user-agent-headers / headers /
//                              uplink directly in `xhttp-opts`
// so they are translated on the way across rather than dropped.
const XHTTP_SINGBOX_TYPE = 'xhttp';

const warn = (list, msg) => { if (list.indexOf(msg) === -1) list.push(msg); };

/** Strip the `_` prefix / drop empty values so sing-box won't choke on them. */
const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
};

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Clash writes ALPN as a list; some generators emit a comma string. */
const toAlpnList = (v) => {
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  if (typeof v === 'string' && v.trim()) return v.split(',').map(s => s.trim()).filter(Boolean);
  return [];
};

const bool = (v, dflt = false) => (v === undefined || v === null ? dflt : !!v);

// ─── Clash proxy -> sing-box outbound ───

/**
 * Convert a single Clash proxy mapping to a sing-box outbound.
 * Returns null when the proxy type has no sing-box equivalent we can emit.
 */
function clashProxyToOutbound(p, warnings) {
  if (!p || typeof p !== 'object') return null;
  const name = p.name || '';
  const type = String(p.type || '').toLowerCase();
  const server = p.server;
  const port = p.port == null ? null : Number(p.port);

  if (!server || !port) {
    warn(warnings, `Proxy "${name || '(unnamed)'}" skipped: missing server or port.`);
    return null;
  }

  const ob = { type, tag: name, server, server_port: port };

  // Protocol-specific credentials
  if (type === 'vmess') {
    ob.uuid = p.uuid;
    ob.alter_id = Number(p.alterId || p.alterid || 0);
    ob.security = p.cipher || 'auto';
    if (!ob.uuid) { warn(warnings, `VMess proxy "${name}" skipped: missing uuid.`); return null; }
  } else if (type === 'vless') {
    ob.uuid = p.uuid;
    if (!ob.uuid) { warn(warnings, `VLESS proxy "${name}" skipped: missing uuid.`); return null; }
    if (p.flow) ob.flow = p.flow;
    if (p.packetEncoding) ob.packet_encoding = p.packetEncoding;
  } else if (type === 'trojan') {
    ob.password = p.password;
    if (!ob.password) { warn(warnings, `Trojan proxy "${name}" skipped: missing password.`); return null; }
  } else if (type === 'shadowsocks' || type === 'ss') {
    // Clash canonical name is "ss"; "shadowsocks" is accepted as an alias
    // because some generators emit it. This project's own YAML generator
    // (frontend YamlGeneratorPage.nodeToYaml) writes "ss".
    // sing-box calls the field "method" (Clash calls it "cipher").
    ob.type = 'shadowsocks';
    ob.method = p.cipher;
    ob.password = p.password;
    if (!ob.method) { warn(warnings, `Shadowsocks proxy "${name}" skipped: missing cipher.`); return null; }
  } else if (type === 'hysteria2' || type === 'hy2') {
    ob.type = 'hysteria2';
    ob.password = p.password;
    if (p.obfs) ob.obfs = { type: p.obfs, password: p['obfs-password'] || p.obfs_password || '' };
    if (p.upmbps) ob.up_mbps = Number(p.upmbps);
    if (p.downmbps) ob.down_mbps = Number(p.downmbps);
    if (!ob.password) { warn(warnings, `Hysteria2 proxy "${name}" skipped: missing password.`); return null; }
  } else {
    warn(warnings, `Proxy "${name}" (type: ${type || 'unknown'}) has no sing-box equivalent and was omitted.`);
    return null;
  }

  // Transport
  const network = String(p.network || '').toLowerCase();
  if (network && network !== 'tcp' && CLASH_NETWORKS.has(network)) {
    const t = { type: network };
    if (network === 'ws') {
      t.path = (p['ws-opts'] && p['ws-opts'].path) || p['ws-path'] || '/';
      const headers = (p['ws-opts'] && p['ws-opts'].headers) || p['ws-headers'] || {};
      // Clash writes the host header capitalised as `Host`; preserve either case.
      const hostVal = headers.Host || headers.host;
      if (hostVal) {
        t.headers = { Host: hostVal };
      }
      if (p['ws-opts'] && p['ws-opts']['max-early-data'] != null) {
        t.max_early_data = Number(p['ws-opts']['max-early-data']);
      }
      if (p['ws-opts'] && p['ws-opts']['early-data-header-name']) {
        t.early_data_header_name = p['ws-opts']['early-data-header-name'];
      }
    } else if (network === 'grpc') {
      t.service_name = p['grpc-opts'] ? p['grpc-opts']['grpc-service-name'] : (p['grpc-service-name'] || '');
    } else if (network === 'h2') {
      const h2 = p['h2-opts'] || {};
      t.host = asArray(h2.host)[0] || '';
      t.path = h2.path || '/';
    } else if (network === 'http') {
      const http = p['http-opts'] || {};
      t.path = http.path || '/';
      const hostList = asArray(http.headers && http.headers.Host ? http.headers.Host : http.headers && http.headers.host);
      if (hostList.length) t.host = hostList[0];
    } else if (network === 'xhttp') {
      // Emitted in exactly the shape the portal's JSON generator produces, so a
      // YAML profile converted to JSON is indistinguishable from one generated
      // natively: { type, host, path, mode, extra? }.
      const xh = p['xhttp-opts'] || {};
      t.host = asArray(xh.host)[0] || server;
      t.path = xh.path || '/';
      t.mode = xh.mode || 'auto';

      // Clash keeps the advanced knobs as siblings of host/mode/path, while
      // the JSON dialect nests them under `extra`. Translate rather than drop.
      // 1 of the 170 production xhttp nodes uses them (max-body-size, padding,
      // user-agent, headers, uplink), so this path is real, not theoretical.
      const extra = {};
      if (xh['max-body-size'] != null) extra.maxBodySize = xh['max-body-size'];
      if (xh['padding-bytes'] != null) extra.xPaddingBytes = xh['padding-bytes'];
      if (xh['user-agent'] != null) extra.userAgent = xh['user-agent'];
      if (xh['user-agent-headers'] != null) extra.userAgentHeaders = xh['user-agent-headers'];
      if (xh.uplink != null) extra.uplink = xh.uplink;
      if (xh.headers != null) extra.headers = xh.headers;
      if (Object.keys(extra).length) t.extra = extra;
    }
    if (Object.keys(t).length > 1) ob.transport = t;
  }

  // TLS / Reality — Clash keeps this in `tls:` / `reality-opts:`.
  //
  // TLS detection is deliberately layered:
  //  1. hysteria2/hy2 is TLS-only at the protocol level in sing-box, so it is
  //     always on regardless of what the Clash file says.
  //  2. An explicit `tls: false` is always honoured.
  //  3. Otherwise `tls: true`, OR the presence of a field that only makes sense
  //     under TLS (sni / servername / alpn / skip-cert-verify / reality-opts /
  //     client-fingerprint), turns it on. Many hand-written and LLM-generated
  //     profiles omit `tls: true` while still setting those fields; dropping
  //     them would serve a plaintext node to a client expecting TLS.
  const tlsImplied = p.sni || p.servername || p.alpn
    || p['skip-cert-verify'] != null || p['reality-opts'] || p['client-fingerprint'];
  const tlsOn = type === 'hysteria2'
    ? true
    : (p.tls === false ? false : bool(p.tls) || !!tlsImplied);

  if (tlsOn) {
    const tls = { enabled: true, server_name: p.servername || p.sni || '' };
    if (p['skip-cert-verify'] != null) tls.insecure = bool(p['skip-cert-verify']);
    if (p['client-fingerprint']) tls.utls = { enabled: true, fingerprint: p['client-fingerprint'] };
    const alpn = toAlpnList(p.alpn);
    if (alpn.length) tls.alpn = alpn;

    if (p['reality-opts']) {
      const r = p['reality-opts'];
      tls.reality = { enabled: true, public_key: r['public-key'] || '', short_id: r['short-id'] || '' };
      if (r['spider-x'] != null) tls.reality.spider_x = r['spider-x'];
      if (!tls.server_name) tls.server_name = p.servername || '';
    }
    ob.tls = compact(tls);
  }

  return ob;
}

/**
 * Clash proxy-groups -> sing-box selector / urltest outbounds.
 *
 * sing-box has exactly two group types: `selector` (manual) and `urltest`
 * (latency-tested). Clash has four, so the mapping is:
 *
 *   select        -> selector   (exact)
 *   url-test      -> urltest    (exact)
 *   fallback      -> urltest    (approximation - see note)
 *   load-balance  -> urltest    (approximation - see note)
 *
 * Why `fallback` and `load-balance` both become `urltest`:
 *   - `fallover` picks the FIRST healthy proxy in list order and only advances
 *     when one dies. `urltest` picks the FASTEST. They agree while everything is
 *     healthy, which is the overwhelmingly common case, and differ only during
 *     an outage. sing-box has no ordered-failover group, and silently dropping
 *     the group would leave the profile with no failover at all, so `urltest` is
 *     the closest available behaviour. A warning is emitted so the operator
 *     knows the semantic difference.
 *   - `load-balance` spreads traffic across nodes; `urltest` sends everything
 *     through the single fastest node. Different behaviour, but the only
 *     latency-aware option sing-box offers. Also warned.
 *
 * Members are resolved defensively: a group may reference another group, a
 * built-in (DIRECT/REJECT/PASS), a name that no longer exists, or the special
 * `GLOBAL` implicit group. Anything that would produce a dangling reference in
 * the emitted config is dropped with a warning, because sing-box refuses to
 * start on an unknown tag.
 */
function clashGroupsToOutbounds(clash, outbounds, warnings) {
  const groups = asArray(clash['proxy-groups']);
  if (groups.length === 0) return [];

  // Tags that exist in the emitted config so far.
  const known = new Set(outbounds.map(o => o.tag));
  const builtIn = new Set(['DIRECT', 'REJECT', 'PASS', 'COMPATIBLE', 'GLOBAL']);
  const usedTags = new Set(known);

  // Reserve a unique tag for each group up front so groups can reference each
  // other regardless of declaration order.
  const tagFor = new Map();
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const base = String(g.name || '').trim() || 'group';
    let tag = base;
    let n = 2;
    while (usedTags.has(tag)) tag = `${base}-${n++}`;
    usedTags.add(tag);
    tagFor.set(g, tag);
  }

  // Second pass: build the outbounds.
  const produced = [];
  const reservedTags = new Set(tagFor.values());
  for (const g of groups) {
    if (!g || typeof g !== 'object') continue;
    const tag = tagFor.get(g);
    const gtype = String(g.type || 'select').toLowerCase();
    const name = g.name || tag;

    // Reject unsupported group types up front so the operator is told what the
    // actual problem is, rather than a confusing "no members" message.
    const SUPPORTED = new Set(['select', 'url-test', 'urltest', 'fallback', 'load-balance', 'loadbalance']);
    if (!SUPPORTED.has(gtype)) {
      warn(warnings, `Group "${name}" has unsupported type "${g.type}" and was skipped (sing-box supports only select and url-test).`);
      continue;
    }

    // Resolve member names to tags that actually exist in the output.
    const members = [];
    let dropped = 0;
    for (const raw of asArray(g.proxies)) {
      const m = String(raw);
      if (builtIn.has(m)) {
        dropped++;
        continue; // direct/block already exist as outbounds; don't alias them
      }
      if (known.has(m) || reservedTags.has(m)) { members.push(m); continue; }
      dropped++;
    }

    if (members.length === 0) {
      warn(warnings, `Group "${name}" was skipped: none of its members survived conversion.`);
      continue;
    }
    if (dropped > 0) {
      warn(warnings, `Group "${name}" dropped ${dropped} member(s) that have no sing-box equivalent.`);
    }

    if (gtype === 'select') {
      produced.push({ type: 'selector', tag, outbounds: members, default: members[0] });
    } else if (gtype === 'url-test' || gtype === 'urltest') {
      produced.push(compact({
        type: 'urltest',
        tag,
        outbounds: members,
        url: typeof g.url === 'string' && g.url.trim() ? g.url.trim() : undefined,
        interval: toSingboxDuration(g.interval),
        tolerance: g.tolerance == null ? undefined : Number(g.tolerance),
      }));
    } else if (gtype === 'fallback') {
      warn(warnings, `Group "${name}" (fallback) became a sing-box "urltest": it will pick the fastest node instead of the first healthy one.`);
      produced.push(compact({
        type: 'urltest',
        tag,
        outbounds: members,
        url: typeof g.url === 'string' && g.url.trim() ? g.url.trim() : undefined,
        interval: toSingboxDuration(g.interval),
        tolerance: g.tolerance == null ? undefined : Number(g.tolerance),
      }));
    } else if (gtype === 'load-balance' || gtype === 'loadbalance') {
      warn(warnings, `Group "${name}" (load-balance) became a sing-box "urltest": traffic will use the fastest node rather than being spread across nodes.`);
      produced.push(compact({
        type: 'urltest',
        tag,
        outbounds: members,
        url: typeof g.url === 'string' && g.url.trim() ? g.url.trim() : undefined,
        interval: toSingboxDuration(g.interval),
      }));
    } else {
      warn(warnings, `Group "${name}" has unsupported type "${g.type}" and was skipped.`);
    }
  }

  return produced;
}
/**
 * Clash writes `interval` as a bare number of SECONDS ("120"). sing-box
 * requires a Go duration string ("2m"). Passing "120" through verbatim makes
 * sing-box fail to parse the config, so the unit must be added.
 */
function toSingboxDuration(value) {
  if (value == null || value === '') return undefined;
  if (typeof value === 'string' && /^\d+(ms|s|m|h)$/.test(value.trim())) {
    return value.trim(); // already a duration
  }
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return undefined;
  if (n % 3600 === 0) return `${n / 3600}h`;
  if (n % 60 === 0) return `${n / 60}m`;
  return `${n}s`;
}

/**
 * Clash config (parsed object) -> sing-box config object.
 */
function clashToSingbox(clash, warnings = []) {
  if (!clash || typeof clash !== 'object') {
    throw new Error('Clash config is empty or not an object');
  }
  const proxies = asArray(clash.proxies);
  const outbounds = [];

  for (const p of proxies) {
    const ob = clashProxyToOutbound(p, warnings);
    if (ob) outbounds.push(compact(ob));
  }

  if (outbounds.length === 0) {
    throw new Error('No convertible proxies found (Clash "proxies" list is empty or unsupported)');
  }

  // The first proxy KEEPS its original Clash name.
  //
  // An earlier version renamed it to "proxy" so single-outbound clients had a
  // predictable default. That was wrong for a subscription: the Clash files
  // lead with a named node (SG01, HK01, ...), so the rename erased the only
  // human-readable label on that node and Hiddify showed "proxy" instead.
  // Clash groups already reference proxies by their original names, so not
  // renaming also means no name-remapping table is needed here.
  const defaultProxyTag = outbounds[0].tag;

  // A top-level selector so the user can always pick a node manually, mirroring
  // the "choose a server" affordance every Clash client shows. It deliberately
  // does NOT contain the latency groups — nesting the auto / failover groups
  // inside the manual selector is what lets a user either choose a node by hand
  // or let sing-box decide, which is the whole point.
  if (outbounds.length > 1) {
    outbounds.unshift({
      type: 'selector',
      tag: 'select',
      outbounds: outbounds.map(o => o.tag),
      default: defaultProxyTag,
    });
  }

  // Real Clash proxy-groups (Auto Switch / Failover / select / url-test) become
  // sing-box selector / urltest outbounds, so automatic switching and failover
  // survive the conversion.
  //
  // 'select' is already the first outbound, and sing-box routes through the
  // first outbound by default, so the manual selector stays the default route
  // and the user is not silently forced through an automatic group.
  for (const g of clashGroupsToOutbounds(clash, outbounds, warnings)) outbounds.push(g);

  if (clash.rules && clash.rules.length) {
    warn(warnings, `Clash has ${clash.rules.length} rule(s) but sing-box routing is not generated; all traffic uses the default proxy.`);
  }

  outbounds.push(
    { type: 'direct', tag: 'direct' },
    { type: 'block', tag: 'block' }
  );

  return {
    log: { level: 'info', timestamp: true },
    outbounds,
  };
}

// ─── sing-box outbound -> Clash proxy ───

/**
 * Convert a single sing-box outbound to a Clash proxy mapping.
 * Non-proxy outbounds (selector/direct/block) return null.
 */
function outboundToClashProxy(ob, warnings) {
  if (!ob || typeof ob !== 'object') return null;
  const type = String(ob.type || '').toLowerCase();
  if (!PROXY_TYPES.includes(type)) return null;

  const server = ob.server;
  const port = ob.server_port == null ? null : Number(ob.server_port);
  if (!server || !port) {
    warn(warnings, `Outbound "${ob.tag || '(untagged)'}" skipped: missing server or server_port.`);
    return null;
  }

  const name = ob.tag || `${type}-${server}`;
  const p = { name, type, server, port };
  const transportType = ob.transport && ob.transport.type ? ob.transport.type : '';

  if (type === 'vmess') {
    p.uuid = ob.uuid;
    p.alterId = Number(ob.alter_id || 0);
    p.cipher = ob.security || 'auto';
  } else if (type === 'vless') {
    p.uuid = ob.uuid;
    if (ob.flow) p.flow = ob.flow;
    if (ob.packet_encoding) p.packetEncoding = ob.packet_encoding;
  } else if (type === 'trojan') {
    p.password = ob.password;
  } else if (type === 'shadowsocks') {
    p.cipher = ob.method;
    p.password = ob.password;
  } else if (type === 'hysteria2') {
    p.password = ob.password;
    if (ob.up_mbps) p.upmbps = Number(ob.up_mbps);
    if (ob.down_mbps) p.downmbps = Number(ob.down_mbps);
    if (ob.obfs && ob.obfs.type) {
      p.obfs = ob.obfs.type;
      p['obfs-password'] = ob.obfs.password || '';
    }
  }

  // Transport
  if (transportType && transportType !== 'tcp') {
    p.network = transportType;
    if (transportType === 'ws') {
      const wsOpts = {};
      if (ob.transport.path) wsOpts.path = ob.transport.path;
      const hostVal = ob.transport.headers && (ob.transport.headers.Host || ob.transport.headers.host);
      if (hostVal) wsOpts.headers = { Host: hostVal };
      if (ob.transport.max_early_data != null) wsOpts['max-early-data'] = Number(ob.transport.max_early_data);
      if (ob.transport.early_data_header_name) wsOpts['early-data-header-name'] = ob.transport.early_data_header_name;
      if (Object.keys(wsOpts).length) p['ws-opts'] = wsOpts;
    } else if (transportType === 'grpc') {
      if (ob.transport.service_name) p['grpc-opts'] = { 'grpc-service-name': ob.transport.service_name };
    } else if (transportType === 'h2') {
      const h2Opts = {};
      if (ob.transport.host) h2Opts.host = ob.transport.host;
      if (ob.transport.path) h2Opts.path = ob.transport.path;
      if (Object.keys(h2Opts).length) p['h2-opts'] = h2Opts;
    } else if (transportType === 'http') {
      const httpOpts = {};
      if (ob.transport.path) httpOpts.path = ob.transport.path;
      const hostList = asArray(ob.transport.host);
      if (hostList.length) httpOpts.headers = { Host: hostList };
      if (Object.keys(httpOpts).length) p['http-opts'] = httpOpts;
    } else if (transportType === XHTTP_SINGBOX_TYPE) {
      // Inverse of the xhttp branch in clashProxyToOutbound: unwrap `extra`
      // back into the sibling keys Clash expects inside `xhttp-opts`.
      const t = ob.transport;
      const xOpts = compact({
        host: asArray(t.host)[0],
        path: t.path,
        mode: t.mode || 'auto',
      });
      const ex = t.extra && typeof t.extra === 'object' ? t.extra : {};
      const flat = compact({
        'max-body-size': ex.maxBodySize,
        'padding-bytes': ex.xPaddingBytes,
        'user-agent': ex.userAgent,
        'user-agent-headers': ex.userAgentHeaders,
        uplink: ex.uplink,
        headers: ex.headers,
      });
      Object.assign(xOpts, flat);
      if (Object.keys(xOpts).length) p['xhttp-opts'] = xOpts;
    } else {
      warn(warnings, `Outbound "${name}" uses transport "${transportType}" which Clash does not support here; it was exported without transport settings.`);
    }
  }

  // TLS / Reality
  if (ob.tls && ob.tls.enabled) {
    p.tls = true;
    if (ob.tls.server_name) p.servername = ob.tls.server_name;
    if (ob.tls.insecure) p['skip-cert-verify'] = true;
    if (ob.tls.utls && ob.tls.utls.fingerprint) p['client-fingerprint'] = ob.tls.utls.fingerprint;
    const alpn = toAlpnList(ob.tls.alpn);
    if (alpn.length) p.alpn = alpn;
    if (ob.tls.reality && ob.tls.reality.enabled) {
      p['reality-opts'] = compact({
        'public-key': ob.tls.reality.public_key || '',
        'short-id': ob.tls.reality.short_id || '',
        'spider-x': ob.tls.reality.spider_x,
      });
    }
  }

  return p;
}

/**
 * sing-box config object -> Clash config object.
 */
function singboxToClash(sb, warnings = []) {
  if (!sb || typeof sb !== 'object' || !Array.isArray(sb.outbounds)) {
    throw new Error('Not a sing-box config: missing "outbounds" array');
  }

  const proxies = [];
  const selectorMembers = [];

  for (const ob of sb.outbounds) {
    if (ob.type === 'selector') {
      // Preserve an existing selector's membership as a Clash group.
      (ob.outbounds || []).forEach(t => selectorMembers.push(t));
      continue;
    }
    const p = outboundToClashProxy(ob, warnings);
    if (p) proxies.push(p);
  }

  if (proxies.length === 0) {
    throw new Error('No convertible proxy outbounds found in the sing-box config');
  }

  // Clash requires unique proxy names within a file. sing-box tags are only
  // unique per outbound, but a hand-edited file can repeat them; disambiguate
  // rather than emitting a config the client silently rejects.
  const seen = new Map();
  for (const p of proxies) {
    const n = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, n);
    if (n > 1) p.name = `${p.name}-${n}`;
  }

  // A proxy group needs a name distinct from every proxy name.
  let groupName = 'PROXY';
  while (seen.has(groupName)) groupName += '-';

  const members = proxies.map(p => p.name);
  const group = { name: groupName, type: 'select', proxies: members };

  // Keep any selector membership that actually resolves to a real proxy.
  // (Proxy names are never rewritten, so a proxy may legitimately be called
  // "proxy" — no tag is special-cased here.)
  const known = new Set(members);
  const extra = selectorMembers.filter(t => known.has(t) && !members.includes(t));
  if (extra.length) group.proxies = [groupName, ...extra];

  const clash = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    proxies,
    'proxy-groups': [group],
  };

  // Preserve DNS settings when the source has them; drop the rest silently
  // since they have no Clash equivalent.
  if (sb.dns && typeof sb.dns === 'object') {
    const dns = {};
    if (Array.isArray(sb.dns.servers)) dns.servers = sb.dns.servers;
    if (sb.dns.strategy) dns['enhanced-mode'] = sb.dns.strategy;
    if (Object.keys(dns).length) clash.dns = dns;
  }

  if (sb.route && sb.route.rules && sb.route.rules.length) {
    warn(warnings, `sing-box has ${sb.route.rules.length} routing rule(s); Clash "rules" were not generated.`);
  }

  return clash;
}

// ─── Text entry points ───

/** Parse Clash YAML text into a sing-box config object. */
function yamlToJsonObject(yamlText) {
  let parsed;
  try {
    parsed = yaml.load(yamlText);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e.reason || e.message}`);
  }
  if (parsed === null || parsed === undefined) {
    throw new Error('YAML file is empty');
  }
  const warnings = [];
  const out = clashToSingbox(parsed, warnings);
  return { config: out, warnings };
}

/** Parse sing-box JSON text into a Clash config object. */
function jsonToYamlObject(jsonText) {
  let parsed;
  try {
    parsed = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON root must be an object (expected a sing-box config)');
  }
  const warnings = [];
  const out = singboxToClash(parsed, warnings);
  return { config: out, warnings };
}

/**
 * Serialise a sing-box config object to JSON text.
 * `sortKeys` is deliberately OFF: these files are read by humans, and
 * alphabetical ordering is exactly what made generated configs hard to diff.
 */
function stringifySingbox(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

/**
 * Serialise a Clash config object to YAML text.
 *
 * Clash requires proxy-level lists (notably `alpn`) to be INLINE — a
 * block sequence at proxy depth is invalid and breaks the client's parser.
 * js-yaml's `flowLevel` option cannot express "inline only for this one key",
 * so we dump with block style and post-process the known offender.
 */
function stringifyClash(obj) {
  let text = yaml.dump(obj, {
    indent: 2,
    lineWidth: -1,      // never wrap long UUIDs / keys
    noRefs: true,       // avoid YAML anchors
    quotingType: '"',
    forceQuotes: false,
  });

  // Collapse `alpn:` block sequences into inline lists. Anchor to exactly
  // 2 spaces (the block's opening "- alpn:") or 4 (a proxy field) so a nested
  // alpn inside ws-opts/reality-opts is never touched.
  const lines = text.split('\n');
  const outLines = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^( {2}- | {4})alpn:\s*$/);
    if (!m) { outLines.push(lines[i]); continue; }
    const items = [];
    let j = i + 1;
    while (j < lines.length) {
      const itemMatch = lines[j].match(/^ {6}- (.+)$/);
      if (!itemMatch) break;
      items.push(itemMatch[1].trim());
      j++;
    }
    if (items.length === 0) { outLines.push(lines[i]); continue; }
    const prefix = m[1] === '  - ' ? '  - alpn' : '    alpn';
    outLines.push(`${prefix}: [${items.join(', ')}]`);
    i = j - 1;
  }

  return outLines.join('\n');
}

// ─── Subscription profile naming ───

// Subscription clients (Hiddify first) name a remote profile from, in order:
// a user override, the `profile-title` response header, `content-disposition`,
// the URL fragment, and finally the URL filename. This key server's URL ends
// in a random 32-char token, so without a `profile-title` header the app shows
// that token to the customer. A human-readable name has to be derived instead.
//
// Both inputs come from how the configs are actually authored:
//   - the leading YAML comment, e.g. "# VChannel-Premium (Unlimited) v3"
//     carries the plan;
//   - the filename, e.g. "vchannel-config-kyawhtet.yaml"
//     carries the customer handle.
// Together they produce "VChannel Premium - Kyaw Htet".

const PROFILE_PLAN_DEFAULT = 'VChannel Premium';

// Burmese romanized names are normally two or three words, but config
// filenames are written without spaces ("kyawhtet", "hnineilaptop",
// "yanlinhtetpc"). Splitting them needs a vocabulary, and a wrong split is
// worse than no split: it invents a name the customer does not have.
//
// So the split only fires when it is unambiguous: EVERY resulting part must
// be a known Burmese name component. A handle that does not decompose cleanly
// is left alone and title-cased whole ("Aanwe", "Vesper"), which is honest.
// Components only — deliberately NO compound entries like "kyawhtet". A
// compound in this set would match the whole handle first and block the
// 2-way split into "kyaw" + "htet", which is the behaviour we want.
//
// Every entry below is attested in the config corpus, either as a standalone
// handle or as a prefix/suffix of one.
const BURMESE_NAME_PARTS = new Set([
  // --- syllabic given names ---
  'aung', 'aye', 'chi', 'cho', 'gyi', 'gyo', 'hla', 'hpa', 'hpaing', 'htet',
  'htin', 'htoo', 'ka', 'khin', 'koe', 'ko', 'ku', 'kyar', 'kyaw', 'kyi',
  'lay', 'lei', 'lin', 'lwin', 'ma', 'maw', 'min', 'moe', 'myat', 'myo',
  'myint', 'nang', 'naw', 'ngwe', 'ni', 'nwe', 'nyein', 'pa', 'pyi', 'pyu',
  'san', 'saung', 'shin', 'shwe', 'swe', 'ta', 'tat', 'than', 'thar', 'thet',
  'thin', 'thuzar', 'tun', 'tunnaing', 'wa', 'wai', 'war', 'win', 'wun',
  'ya', 'yan', 'yat', 'yaw', 'yee', 'yin', 'yint', 'zin', 'zaw',
  // short but unambiguous Burmese name syllables
  'oo', 'za', 'yout', 'thu', 'hlyo', 'mya', 'nyo', 'nyi', 'noe', 'nyan',
  'kha', 'kaw', 'na', 'pwe', 'pyai', 'pya', 'phy', 'phyoe', 'po', 'han',

  // --- common Burmese name particles / roots ---
  // NOTE: no compound entries here. splitBurmeseName refuses to split a
  // string that is itself in this set, so listing "aungmin" would permanently
  // block the correct "Aung Min" split.
  'aungmyat', 'aungwin', 'aunglay',
  'dar', 'andar', 'barani', 'chit', 'chitnu', 'choe', 'daw', 'din',
  'hlaing', 'hlahtin', 'hlahtwe', 'hmin', 'hpone', 'hth', 'htay', 'hein',
  'hant', 'han', 'kaung', 'khaing', 'khant', 'kha', 'khine', 'kht', 'kkin',
  'kkya', 'kzin', 'kay', 'kaing', 'kaw', 'koe',
  'lay', 'lei', 'linn', 'lway', 'lwai',
  'may', 'minhla', 'minhtet', 'minkhant', 'minkhaung', 'minhthu', 'minzay',
  'mon', 'myatthant', 'myatzaw', 'myo', 'min',
  'nanda', 'nandaa', 'naing', 'nar', 'naychi', 'nge', 'nei', 'noe', 'nwe',
  'nyitar', 'nyit', 'nyi',
  'paing', 'pyae', 'paaing', 'phyo', 'phyumyint', 'pwe', 'pyai', 'pya',
  'phy', 'phyoe', 'po',
  'rewa', 'rex', 'rk', 'rose',
  'saungnan', 'sai', 'san', 'sandar', 'sheila', 'shine', 'sisi',
  'soe', 'su', 'sweya', 'swe',
  'tayza', 'theingi', 'thidar', 'thetkyi', 'thetmin', 'thetwaddy',
  'thazin', 'thinzar', 'thiri', 'thandar', 'tha',
  'tike', 'toe', 'tu', 'tta', 'tts',
  'wuttar', 'wunna', 'winthu', 'win',
  'yadana', 'yadanar', 'yadan', 'yar', 'zam', 'zarm', 'zinyan', 'zinmar',
  'zinwa', 'zawzaw', 'zarm',
  // Roots used to complete 3-part splits. Multi-word names that merely LOOK
  // like compounds are deliberately absent: because splitBurmeseName refuses to
  // split a string that is itself a known name, listing "kyawzinlin" here would
  // permanently block the correct "Kyaw Zin Lin" split.
  'sunandar', 'maung', 'shine', 'winthu', 'nyan',
  'theingi', 'hant', 'kaung', 'naing', 'tike',

  // --- international / loanword given names seen in the corpus ---
  'aerial', 'akhein', 'angel', 'angelmay', 'david', 'daniel', 'emily', 'felix',
  'ian', 'isabella', 'jack', 'james', 'jessica', 'michael', 'quinn', 'rachel',
  'ray', 'ron', 'victoria', 'vincent', 'violeta', 'violet', 'vesper', 'simon',
  'ajay', 'vinod', 'sagar', 'chan', 'hpa', 'knmk', 'lks', 'kgm', 'mts', 'psoe',
]);

/**
 * Split a run-together romanized name into its parts, but only when every
 * resulting part is a known component. Returns null when the split would be a
 * guess.
 *
 * Greedy longest-prefix first, then backtracks to shorter prefixes, and tries
 * 2- and 3-part decompositions.
 */
function splitBurmeseName(run) {
  const s = String(run || '').toLowerCase();
  if (!s) return null;

  // Every part must itself be a known component. The final part is checked
  // against the same dictionary as the others — relaxing that produced real
  // mistakes ("sandar" -> "San Dar", "htetmyatthant" -> "Htetmyat Thant"),
  // so a handle is only split when it decomposes with no residue.
  const search = (remaining, parts, slots) => {
    if (slots === 1) {
      if (!remaining || !BURMESE_NAME_PARTS.has(remaining)) return null;
      return parts.concat(remaining);
    }
    for (let len = remaining.length - (slots - 1); len >= 1; len--) {
      const head = remaining.slice(0, len);
      if (!BURMESE_NAME_PARTS.has(head)) continue;
      const tail = search(remaining.slice(len), parts.concat(head), slots - 1);
      if (tail) return tail;
    }
    return null;
  };

  // A compound that is itself a name must win over its parts: "sandar" is one
  // word, not "san" + "dar". So try each part count LONGEST-prefix-first and
  // additionally refuse a split when the whole string is itself a known name.
  if (BURMESE_NAME_PARTS.has(s)) return null;

  for (const count of [2, 3]) {
    if (s.length < count) continue;
    const parts = search(s, [], count);
    if (parts) return parts;
  }
  return null;
}

/** Title-case each hyphen/underscore/space/dot separated word. */
const titleCaseWords = (s) => String(s)
  .split(/[\s._-]+/)
  .filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join(' ');

/**
 * Read the plan name from the file's leading comment.
 * Drops the version marker ("v3") and any qualifier ("(Unlimited)"), and
 * normalises "VChannel-Premium" to "VChannel Premium".
 */
function planFromComment(rawYaml) {
  if (!rawYaml) return '';
  const firstLine = String(rawYaml).split(/\r?\n/, 1)[0] || '';
  const m = firstLine.match(/^#\s*(.+?)\s*$/);
  if (!m) return '';
  const plan = m[1]
    .replace(/\s+v\d+\s*$/i, '')      // trailing "v3"
    .replace(/\s*\(.*?\)\s*/g, ' ')   // "(Unlimited)"
    .replace(/[:#]+/g, ' ')           // "Expire Date:" -> "Expire Date"
    .replace(/\s+/g, ' ')
    .trim();
  if (!plan) return '';
  return titleCaseWords(plan.replace(/-/g, ' '));
}

/**
 * Read the customer name from the filename.
 *
 * Handles appear as "vchannel-config-<handle>.yaml". The handle may itself
 * contain hyphens ("hninei-laptop") or run words together ("kyawhtet"), and
 * may end in digits that identify a second account ("waipaung02").
 *
 * A bare hex token is not a name, so it yields ''.
 */
function customerFromFilename(filename) {
  let base = String(filename || '').replace(/\.(yaml|yml|json|txt)$/i, '');
  base = base.replace(/^vchannel[-_]config[-_]/i, '');
  base = base.replace(/^[-_]+|[-_]+$/g, '');
  if (!base) return '';
  if (/^[0-9a-f]{16,}$/i.test(base)) return ''; // leftover token, not a name

  // Each hyphen-separated chunk is a word; within a chunk, try to split
  // run-together name parts. A trailing digit group is an account suffix and
  // is never split into, so "waipaung02" -> "Waipaung 02" and "nge04s" ->
  // "Nge 04s".
  const words = [];
  for (const chunk of base.split(/[-_]+/).filter(Boolean)) {
    const m = chunk.match(/^([a-z]+)(\d+[a-z]*)$/i);
    if (m) {
      const [, letters, suffix] = m;
      const parts = splitBurmeseName(letters) || [letters];
      words.push(...parts);
      words.push(suffix);
      continue;
    }
    const parts = splitBurmeseName(chunk);
    if (parts) { words.push(...parts); continue; }
    words.push(chunk);
  }

  return words
    .map(w => (/^\d+$/.test(w) ? w : titleCaseWords(w)))
    .join(' ');
}

/**
 * Build the `profile-title` value for a config file.
 * Falls back to the plan alone when the filename carries no usable name.
 */
function profileTitleFor(filename, rawYaml) {
  const plan = planFromComment(rawYaml) || PROFILE_PLAN_DEFAULT;
  const customer = customerFromFilename(filename);
  return customer ? `${plan} - ${customer}` : plan;
}

module.exports = {
  PROXY_TYPES,
  clashToSingbox,
  singboxToClash,
  clashProxyToOutbound,
  outboundToClashProxy,
  clashGroupsToOutbounds,
  toSingboxDuration,
  yamlToJsonObject,
  jsonToYamlObject,
  stringifySingbox,
  stringifyClash,
  profileTitleFor,
  planFromComment,
  customerFromFilename,
};
