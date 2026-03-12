const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { authenticateToken, isAdmin, isAdminOrServerAdmin } = require('../middleware/authMiddleware');

// Key server config file path
const CONFIG_PATH = path.join(__dirname, '..', 'data', 'keyserver.json');
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Default config
const DEFAULT_CONFIG = {
  port: 8088,
  secretKey: '',
  configDir: '/srv/cmp/configs',
  autoStart: false,
  publicDomain: '',
};

// Token map: persists { byToken: { token: filename }, byFile: { filename: token } }
const TOKEN_MAP_PATH = path.join(DATA_DIR, 'token_map.json');

const loadTokenMap = () => {
  try {
    if (fs.existsSync(TOKEN_MAP_PATH)) {
      const raw = JSON.parse(fs.readFileSync(TOKEN_MAP_PATH, 'utf-8'));
      return { byToken: raw.byToken || {}, byFile: raw.byFile || {} };
    }
  } catch (_) {}
  return { byToken: {}, byFile: {} };
};

const saveTokenMap = (map) => {
  fs.writeFileSync(TOKEN_MAP_PATH, JSON.stringify(map, null, 2), 'utf-8');
};

const getOrCreateToken = (filename) => {
  const map = loadTokenMap();
  if (map.byFile[filename]) return { token: map.byFile[filename], map };
  const token = crypto.randomBytes(16).toString('hex');
  map.byToken[token] = filename;
  map.byFile[filename] = token;
  saveTokenMap(map);
  return { token, map };
};

const removeTokenForFile = (filename) => {
  const map = loadTokenMap();
  const token = map.byFile[filename];
  if (token) {
    delete map.byToken[token];
    delete map.byFile[filename];
    saveTokenMap(map);
  }
};

// Load config
const loadConfig = () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('Error loading keyserver config:', e.message);
  }
  return { ...DEFAULT_CONFIG };
};

// Save config
const saveConfig = (config) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
};

// In-memory key server instance
let keyServerApp = null;
let keyServerInstance = null;
let keyServerStatus = 'stopped'; // stopped | running | error
let keyServerError = '';

// Create and start the key server
const startKeyServer = (config) => {
  return new Promise((resolve, reject) => {
    try {
      if (keyServerInstance) {
        return reject(new Error('Key server is already running'));
      }

      const expressModule = require('express');
      keyServerApp = expressModule();

      // CORS – allow all origins so subscription clients (V2Box, Clash, etc.) can fetch
      keyServerApp.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
      });

      const configDir = config.configDir || DEFAULT_CONFIG.configDir;
      const secretKey = config.secretKey;

      // Ensure config folder exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Convert a sing-box outbound object to a standard proxy URI
      const outboundToURI = (ob) => {
        try {
          const tag = ob.tag || 'proxy';
          const server = ob.server;
          const port = ob.server_port;
          if (!server || !port) return null;

          if (ob.type === 'vmess') {
            const vmessObj = {
              v: '2', ps: tag, add: server, port: port,
              id: ob.uuid || '', aid: ob.alter_id || 0,
              scy: ob.security || 'auto',
              net: ob.transport ? ob.transport.type || 'tcp' : 'tcp',
              type: 'none', host: '', path: '', tls: '', sni: ''
            };
            if (ob.tls && ob.tls.enabled) {
              vmessObj.tls = 'tls';
              vmessObj.sni = ob.tls.server_name || '';
              if (ob.tls.utls && ob.tls.utls.fingerprint) vmessObj.fp = ob.tls.utls.fingerprint;
              if (ob.tls.alpn && ob.tls.alpn.length) vmessObj.alpn = ob.tls.alpn.join(',');
              if (ob.tls.insecure) vmessObj.allowInsecure = 1;
            }
            if (ob.transport) {
              if (ob.transport.type === 'ws') {
                vmessObj.path = ob.transport.path || '/';
                vmessObj.host = (ob.transport.headers && ob.transport.headers.Host) || ob.tls?.server_name || '';
              } else if (ob.transport.type === 'grpc') {
                vmessObj.path = ob.transport.service_name || '';
              }
            }
            return 'vmess://' + Buffer.from(JSON.stringify(vmessObj)).toString('base64');
          }

          if (ob.type === 'vless') {
            const params = new URLSearchParams();
            params.set('type', ob.transport ? ob.transport.type || 'tcp' : 'tcp');
            if (ob.tls && ob.tls.enabled) {
              if (ob.tls.reality && ob.tls.reality.enabled) {
                params.set('security', 'reality');
                if (ob.tls.server_name) params.set('sni', ob.tls.server_name);
                if (ob.tls.reality.public_key) params.set('pbk', ob.tls.reality.public_key);
                if (ob.tls.reality.short_id != null) params.set('sid', ob.tls.reality.short_id);
                if (ob.tls.utls && ob.tls.utls.fingerprint) params.set('fp', ob.tls.utls.fingerprint);
              } else {
                params.set('security', 'tls');
                if (ob.tls.server_name) params.set('sni', ob.tls.server_name);
                if (ob.tls.utls && ob.tls.utls.fingerprint) params.set('fp', ob.tls.utls.fingerprint);
                if (ob.tls.alpn && ob.tls.alpn.length) params.set('alpn', ob.tls.alpn.join(','));
                if (ob.tls.insecure) params.set('allowInsecure', '1');
              }
            }
            if (ob.flow) params.set('flow', ob.flow);
            if (ob.transport) {
              if (ob.transport.type === 'ws') {
                params.set('path', ob.transport.path || '/');
                if (ob.transport.headers && ob.transport.headers.Host) params.set('host', ob.transport.headers.Host);
              } else if (ob.transport.type === 'grpc') {
                params.set('serviceName', ob.transport.service_name || '');
              }
            }
            return `vless://${ob.uuid}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
          }

          if (ob.type === 'trojan') {
            const params = new URLSearchParams();
            params.set('type', ob.transport ? ob.transport.type || 'tcp' : 'tcp');
            if (ob.tls && ob.tls.enabled) {
              params.set('security', 'tls');
              if (ob.tls.server_name) params.set('sni', ob.tls.server_name);
              if (ob.tls.utls && ob.tls.utls.fingerprint) params.set('fp', ob.tls.utls.fingerprint);
              if (ob.tls.alpn && ob.tls.alpn.length) params.set('alpn', ob.tls.alpn.join(','));
              if (ob.tls.insecure) params.set('allowInsecure', '1');
            }
            if (ob.transport) {
              if (ob.transport.type === 'ws') {
                params.set('path', ob.transport.path || '/');
                if (ob.transport.headers && ob.transport.headers.Host) params.set('host', ob.transport.headers.Host);
              } else if (ob.transport.type === 'grpc') {
                params.set('serviceName', ob.transport.service_name || '');
              }
            }
            return `trojan://${ob.password}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
          }

          if (ob.type === 'shadowsocks') {
            const userinfo = Buffer.from(`${ob.method}:${ob.password}`).toString('base64');
            return `ss://${userinfo}@${server}:${port}#${encodeURIComponent(tag)}`;
          }

          if (ob.type === 'hysteria2') {
            const params = new URLSearchParams();
            if (ob.tls && ob.tls.server_name) params.set('sni', ob.tls.server_name);
            if (ob.tls && ob.tls.insecure) params.set('insecure', '1');
            return `hy2://${ob.password}@${server}:${port}?${params.toString()}#${encodeURIComponent(tag)}`;
          }

          return null;
        } catch (_) { return null; }
      };

      // Convert sing-box JSON config to base64-encoded proxy URI list
      const convertSingboxToURIs = (content) => {
        try {
          const config = JSON.parse(content);
          if (!config.outbounds || !Array.isArray(config.outbounds)) return null;
          const proxyTypes = ['vmess', 'vless', 'trojan', 'shadowsocks', 'hysteria2'];
          const uris = config.outbounds
            .filter(ob => proxyTypes.includes(ob.type))
            .map(ob => outboundToURI(ob))
            .filter(Boolean);
          if (uris.length === 0) return null;
          return Buffer.from(uris.join('\n')).toString('base64');
        } catch (_) { return null; }
      };

      // Convert sing-box outbound to V2Ray/Xray outbound format
      const singboxToV2RayOutbound = (ob) => {
        try {
          const tag = ob.tag || 'proxy';
          const server = ob.server;
          const port = ob.server_port;
          if (!server || !port) return null;

          const v2rayOb = { protocol: ob.type, tag };

          // Stream settings (transport + tls)
          const streamSettings = { network: 'tcp', security: 'none' };
          
          if (ob.transport) {
            streamSettings.network = ob.transport.type || 'tcp';
            
            if (ob.transport.type === 'ws') {
              streamSettings.wsSettings = {
                path: ob.transport.path || '/',
                headers: ob.transport.headers || {}
              };
              if (ob.tls?.server_name) streamSettings.wsSettings.headers.Host = ob.tls.server_name;
            } else if (ob.transport.type === 'grpc') {
              streamSettings.grpcSettings = {
                serviceName: ob.transport.service_name || ''
              };
            }
          }

          if (ob.tls && ob.tls.enabled) {
            streamSettings.security = 'tls';
            streamSettings.tlsSettings = {
              serverName: ob.tls.server_name || server,
              allowInsecure: ob.tls.insecure || false,
              alpn: ob.tls.alpn || ['h2', 'http/1.1']
            };
            if (ob.tls.utls && ob.tls.utls.fingerprint) {
              streamSettings.tlsSettings.fingerprint = ob.tls.utls.fingerprint;
            }
          }

          v2rayOb.streamSettings = streamSettings;

          // Protocol-specific settings
          if (ob.type === 'vless') {
            v2rayOb.settings = {
              vnext: [{
                address: server,
                port: port,
                users: [{
                  id: ob.uuid,
                  encryption: ob.packet_encoding || 'none',
                  flow: ob.flow || ''
                }]
              }]
            };
          } else if (ob.type === 'vmess') {
            v2rayOb.settings = {
              vnext: [{
                address: server,
                port: port,
                users: [{
                  id: ob.uuid,
                  alterId: ob.alter_id || 0,
                  security: ob.security || 'auto'
                }]
              }]
            };
          } else if (ob.type === 'trojan') {
            v2rayOb.settings = {
              servers: [{
                address: server,
                port: port,
                password: ob.password
              }]
            };
          } else if (ob.type === 'shadowsocks') {
            v2rayOb.settings = {
              servers: [{
                address: server,
                port: port,
                method: ob.method,
                password: ob.password
              }]
            };
          } else {
            return null;
          }

          return v2rayOb;
        } catch (_) { return null; }
      };

      // Convert sing-box JSON to V2Ray/Xray JSON format for V2Box compatibility
      const convertSingboxToV2Ray = (content, filename) => {
        try {
          const config = JSON.parse(content);
          if (!config.outbounds || !Array.isArray(config.outbounds)) return null;

          const proxyTypes = ['vmess', 'vless', 'trojan', 'shadowsocks'];
          const proxyOutbounds = config.outbounds
            .filter(ob => proxyTypes.includes(ob.type))
            .map((ob, i) => {
              const converted = singboxToV2RayOutbound(ob);
              if (!converted) return null;
              // Ensure each outbound has a unique tag
              converted.tag = converted.tag || `proxy-${i + 1}`;
              return converted;
            })
            .filter(Boolean);

          if (proxyOutbounds.length === 0) return null;

          // Tag the first proxy as 'proxy' for default routing; others keep their tags
          const proxyTags = proxyOutbounds.map((ob, i) => {
            if (i === 0) ob.tag = 'proxy';
            return ob.tag;
          });

          // Build outbound list: all proxy outbounds + selector (if multiple) + freedom + block
          const outboundList = [...proxyOutbounds];
          if (proxyOutbounds.length > 1) {
            outboundList.unshift({
              protocol: 'selector',
              tag: 'select',
              settings: { servers: proxyTags },
              remarks: 'Select server'
            });
          }
          outboundList.push(
            { protocol: 'freedom', tag: 'direct', settings: { domainStrategy: 'AsIs' } },
            { protocol: 'blackhole', tag: 'block', settings: { response: { type: 'http' } } }
          );

          const v2rayConfig = {
            log: { loglevel: 'warning' },
            dns: {
              servers: [{ address: '8.8.8.8', skipFallback: false }],
              queryStrategy: 'UseIP',
              tag: 'dns_out'
            },
            inbounds: [
              {
                tag: 'socks',
                port: 10808,
                protocol: 'socks',
                settings: { auth: 'noauth', udp: true, userLevel: 8 }
              },
              {
                tag: 'http',
                port: 10809,
                protocol: 'http',
                settings: { userLevel: 8 }
              }
            ],
            outbounds: outboundList,
            routing: {
              domainStrategy: 'AsIs',
              rules: [
                { type: 'field', network: 'tcp,udp', outboundTag: proxyOutbounds.length > 1 ? 'select' : 'proxy' }
              ]
            },
            policy: {
              levels: {
                '8': {
                  connIdle: 300,
                  downlinkOnly: 1,
                  handshake: 4,
                  uplinkOnly: 1
                }
              },
              system: {
                statsOutboundDownlink: true,
                statsOutboundUplink: true
              }
            },
            stats: {},
            remarks: filename.replace(/\.(json|yaml)$/, '')
          };

          return JSON.stringify(v2rayConfig, null, 2);
        } catch (_) { return null; }
      };

      keyServerApp.get('/sub/:id', (req, res) => {
        const idParam = req.params.id;
        const userKey = req.query.key;

        // Security Check
        if (!secretKey || userKey !== secretKey) {
          return res.status(403).send('⛔ Access Denied: Invalid Key');
        }

        // Resolve token → actual filename (fall back to treating id as filename directly)
        const tokenMap = loadTokenMap();
        const resolvedFilename = tokenMap.byToken[idParam] || idParam;
        const sanitized = path.basename(resolvedFilename);
        const filePath = path.join(configDir, sanitized);

        if (!fs.existsSync(filePath)) {
          return res.status(404).send('❌ Config Not Found');
        }

        // Set subscription-userinfo header from companion .meta.json if present
        try {
          const metaPath = path.join(configDir, `${sanitized}.meta.json`);
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
            const parts = ['upload=0', 'download=0'];
            if (meta.unlimited) {
              parts.push('total=0');
            } else if (meta.data_limit_gb) {
              parts.push(`total=${Math.round(meta.data_limit_gb * 1073741824)}`);
            }
            if (meta.expire_date) {
              const expTs = Math.floor(new Date(meta.expire_date + 'T23:59:59').getTime() / 1000);
              if (!isNaN(expTs)) parts.push(`expire=${expTs}`);
            }
            res.setHeader('subscription-userinfo', parts.join('; '));
          }
        } catch (_) {}

        res.setHeader('profile-update-interval', '24');

        // For .json files: handle format conversions
        // - default:      base64 proxy URIs (V2Box / V2RayNG / any standard subscription client)
        // - ?format=raw:  proxy-only sing-box JSON {"outbounds":[...]} (sing-box-native clients: V2Box, NekoBox)
        // - ?format=v2ray: full V2Ray/Xray JSON config (V2RayNG local config import, Xray clients)
        if (sanitized.endsWith('.json')) {
          const content = fs.readFileSync(filePath, 'utf-8');
          
          // V2Ray/Xray JSON format for V2RayNG / Xray clients
          if (req.query.format === 'v2ray') {
            try {
              const v2rayJson = convertSingboxToV2Ray(content, sanitized);
              if (v2rayJson) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.send(v2rayJson);
                console.log(`[KeyServer] [${new Date().toISOString()}] Served (V2Ray JSON): ${sanitized} to ${req.ip}`);
                return;
              }
            } catch (_) {}
          }
          
          // Raw sing-box subscription: proxy outbounds only (no selector/urltest/direct/dns/block)
          // Serves {"outbounds":[...]} for sing-box-native clients (V2Box, NekoBox, etc.)
          if (req.query.format === 'raw') {
            try {
              const config = JSON.parse(content);
              const proxyTypes = ['shadowsocks', 'vmess', 'vless', 'trojan', 'hysteria2'];
              const proxyOutbounds = Array.isArray(config.outbounds)
                ? config.outbounds.filter(ob => proxyTypes.includes(ob.type))
                : [];
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.send(JSON.stringify({ outbounds: proxyOutbounds }, null, 2));
              console.log(`[KeyServer] [${new Date().toISOString()}] Served (raw sing-box sub, ${proxyOutbounds.length} nodes): ${sanitized} to ${req.ip}`);
            } catch (_) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.sendFile(filePath);
              console.log(`[KeyServer] [${new Date().toISOString()}] Served (raw fallback): ${sanitized} to ${req.ip}`);
            }
            return;
          }
          
          // Default: base64 proxy URIs — serve as plain text (no attachment, subscription clients need inline)
          try {
            const base64 = convertSingboxToURIs(content);
            if (base64) {
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.send(base64);
              console.log(`[KeyServer] [${new Date().toISOString()}] Served (base64 URIs): ${sanitized} to ${req.ip}`);
              return;
            }
          } catch (_) {}
        }

        // Fallback: serve file as-is (YAML configs, etc.)
        const contentType = sanitized.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : 'text/plain; charset=utf-8';
        if (sanitized.endsWith('.json')) {
          res.setHeader('Content-Disposition', `attachment; filename="${sanitized}"`);
        }
        res.setHeader('Content-Type', contentType);
        res.sendFile(filePath);
        console.log(`[KeyServer] [${new Date().toISOString()}] Served: ${sanitized} to ${req.ip}`);
      });

      // Health check endpoint
      keyServerApp.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
      });

      keyServerInstance = keyServerApp.listen(config.port, () => {
        keyServerStatus = 'running';
        keyServerError = '';
        console.log(`[KeyServer] ✅ Running on port ${config.port}`);
        resolve();
      });

      keyServerInstance.on('error', (err) => {
        keyServerStatus = 'error';
        keyServerError = err.message;
        keyServerInstance = null;
        keyServerApp = null;
        reject(err);
      });
    } catch (err) {
      keyServerStatus = 'error';
      keyServerError = err.message;
      reject(err);
    }
  });
};

// Stop the key server
const stopKeyServer = () => {
  return new Promise((resolve, reject) => {
    if (!keyServerInstance) {
      keyServerStatus = 'stopped';
      return resolve();
    }
    keyServerInstance.close((err) => {
      keyServerInstance = null;
      keyServerApp = null;
      if (err) {
        keyServerStatus = 'error';
        keyServerError = err.message;
        return reject(err);
      }
      keyServerStatus = 'stopped';
      keyServerError = '';
      console.log('[KeyServer] ⛔ Stopped');
      resolve();
    });
  });
};

// ─── API Routes ───

// GET /api/keyserver/config - Get key server config
router.get('/config', authenticateToken, isAdminOrServerAdmin, (req, res) => {
  const config = loadConfig();
  res.json(config);
});

// PUT /api/keyserver/config - Save key server config
router.put('/config', authenticateToken, isAdmin, (req, res) => {
  try {
    const { port, secretKey, configDir, autoStart, publicDomain } = req.body;
    const config = loadConfig();
    if (port != null) config.port = parseInt(port);
    if (secretKey != null) config.secretKey = secretKey;
    if (configDir != null) config.configDir = configDir;
    if (autoStart != null) config.autoStart = autoStart;
    if (publicDomain != null) config.publicDomain = publicDomain;
    saveConfig(config);
    res.json({ message: 'Config saved', config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/generate-key - Generate a random secret key
router.post('/generate-key', authenticateToken, isAdmin, (req, res) => {
  const key = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  res.json({ key });
});

// GET /api/keyserver/status - Get key server status
router.get('/status', authenticateToken, isAdminOrServerAdmin, (req, res) => {
  const config = loadConfig();
  res.json({
    status: keyServerStatus,
    error: keyServerError,
    port: config.port,
  });
});

// POST /api/keyserver/start
router.post('/start', authenticateToken, isAdmin, async (req, res) => {
  try {
    const config = loadConfig();
    if (!config.secretKey) {
      return res.status(400).json({ error: 'Secret key is not configured' });
    }
    await startKeyServer(config);
    res.json({ message: 'Key server started', status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/stop
router.post('/stop', authenticateToken, isAdmin, async (req, res) => {
  try {
    await stopKeyServer();
    res.json({ message: 'Key server stopped', status: 'stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/restart
router.post('/restart', authenticateToken, isAdmin, async (req, res) => {
  try {
    await stopKeyServer();
    const config = loadConfig();
    if (!config.secretKey) {
      return res.status(400).json({ error: 'Secret key is not configured' });
    }
    await startKeyServer(config);
    res.json({ message: 'Key server restarted', status: 'running' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keyserver/keys - List all config files
router.get('/keys', authenticateToken, isAdminOrServerAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;

    if (!fs.existsSync(configDir)) {
      return res.json([]);
    }

    const tokenMap = loadTokenMap();
    const files = fs.readdirSync(configDir)
      .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json') || f.endsWith('.txt')) && !f.endsWith('.meta.json'))
      .map(filename => {
        const filePath = path.join(configDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          token: tokenMap.byFile[filename] || null,
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime,
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/keys - Upload/save a YAML or JSON config file
router.post('/keys', authenticateToken, isAdmin, (req, res) => {
  try {
    const { filename, content, metadata } = req.body;
    if (!filename || !content) {
      return res.status(400).json({ error: 'filename and content are required' });
    }

    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;

    // Ensure directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Sanitize filename
    const sanitized = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = sanitized.endsWith('.yaml') || sanitized.endsWith('.yml') || sanitized.endsWith('.json') || sanitized.endsWith('.txt')
      ? sanitized : `${sanitized}.yaml`;

    const filePath = path.join(configDir, finalName);
    fs.writeFileSync(filePath, content, 'utf-8');

    // Save subscription metadata alongside the config (for subscription-userinfo header)
    if (metadata && typeof metadata === 'object') {
      try {
        const metaPath = path.join(configDir, `${finalName}.meta.json`);
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
      } catch (_) {}
    }

    // Generate or retrieve a stable token for this file (hides the real filename from URLs)
    const { token } = getOrCreateToken(finalName);

    res.json({ message: 'File saved', filename: finalName, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/keyserver/keys/:filename - Delete a config file
router.delete('/keys/:filename', authenticateToken, isAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;
    const sanitized = path.basename(req.params.filename);
    const filePath = path.join(configDir, sanitized);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filePath);
    // Also remove companion .meta.json if present
    try { const metaPath = filePath + '.meta.json'; if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch (_) {}
    // Remove token mapping
    removeTokenForFile(sanitized);
    res.json({ message: 'File deleted', filename: sanitized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/keyserver/keys/:filename/content - Read file content
router.get('/keys/:filename/content', authenticateToken, isAdminOrServerAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;
    const sanitized = path.basename(req.params.filename);
    const filePath = path.join(configDir, sanitized);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ filename: sanitized, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Backup & Restore ───

// GET /api/keyserver/backup - Download a JSON bundle of config + all key files
router.get('/backup', authenticateToken, isAdmin, (req, res) => {
  try {
    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;

    const files = [];
    if (fs.existsSync(configDir)) {
      const entries = fs.readdirSync(configDir)
        .filter(f => (f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json') || f.endsWith('.txt')) && !f.endsWith('.meta.json'));
      for (const filename of entries) {
        const filePath = path.join(configDir, filename);
        const stats = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        files.push({
          filename,
          content,
          size: stats.size,
          modified: stats.mtime,
        });
      }
    }

    const tokenMap = loadTokenMap();
    const backup = {
      version: 1,
      createdAt: new Date().toISOString(),
      config: { ...config },
      tokenMap,
      files,
    };

    const json = JSON.stringify(backup, null, 2);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="keymanager-backup-${ts}.json"`);
    res.send(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/restore - Restore config + key files from a backup JSON bundle
// body.mode: 'merge' (default) = only write new files, skip existing | 'overwrite' = replace everything
router.post('/restore', authenticateToken, isAdmin, (req, res) => {
  try {
    const backup = req.body.backup || req.body;
    const mode = (req.body.mode || 'merge').toLowerCase(); // merge | overwrite

    // Validate backup structure
    if (!backup || typeof backup !== 'object' || !backup.version) {
      return res.status(400).json({ error: 'Invalid backup file format' });
    }

    const results = { configRestored: false, filesRestored: 0, filesSkipped: 0, filesOverwritten: 0, errors: [] };

    // Restore config
    if (backup.config && typeof backup.config === 'object') {
      if (mode === 'overwrite') {
        // Full replace with backup config
        saveConfig({
          port: backup.config.port ?? DEFAULT_CONFIG.port,
          secretKey: backup.config.secretKey ?? DEFAULT_CONFIG.secretKey,
          configDir: backup.config.configDir ?? DEFAULT_CONFIG.configDir,
          autoStart: backup.config.autoStart ?? DEFAULT_CONFIG.autoStart,
          publicDomain: backup.config.publicDomain ?? DEFAULT_CONFIG.publicDomain,
        });
      } else {
        // Merge: only fill in missing values from backup
        const current = loadConfig();
        const merged = {
          port: current.port || backup.config.port,
          secretKey: current.secretKey || backup.config.secretKey,
          configDir: current.configDir || backup.config.configDir,
          autoStart: current.autoStart != null ? current.autoStart : backup.config.autoStart,
          publicDomain: current.publicDomain || backup.config.publicDomain || '',
        };
        saveConfig(merged);
      }
      results.configRestored = true;
    }

    // Restore token map
    if (backup.tokenMap && typeof backup.tokenMap === 'object') {
      if (mode === 'overwrite') {
        saveTokenMap({
          byToken: backup.tokenMap.byToken || {},
          byFile: backup.tokenMap.byFile || {},
        });
      } else {
        const current = loadTokenMap();
        const merged = {
          byToken: { ...(backup.tokenMap.byToken || {}), ...current.byToken },
          byFile: { ...(backup.tokenMap.byFile || {}), ...current.byFile },
        };
        saveTokenMap(merged);
      }
    }

    // Restore key files
    if (Array.isArray(backup.files)) {
      const config = loadConfig();
      const configDir = config.configDir || DEFAULT_CONFIG.configDir;

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // In overwrite mode, delete existing files first
      if (mode === 'overwrite') {
        const existing = fs.readdirSync(configDir)
          .filter(f => /\.(ya?ml|json|txt)$/i.test(f));
        for (const f of existing) {
          try { fs.unlinkSync(path.join(configDir, f)); } catch (_) { /* ignore */ }
        }
      }

      for (const file of backup.files) {
        try {
          if (!file.filename || typeof file.content !== 'string') {
            results.filesSkipped++;
            continue;
          }
          const sanitized = path.basename(file.filename);
          // Only allow yaml/yml/json/txt files
          if (!/\.(ya?ml|json|txt)$/i.test(sanitized)) {
            results.filesSkipped++;
            continue;
          }
          const filePath = path.join(configDir, sanitized);

          if (mode === 'merge' && fs.existsSync(filePath)) {
            results.filesSkipped++;
            continue;
          }

          const existed = fs.existsSync(filePath);
          fs.writeFileSync(filePath, file.content, 'utf-8');
          results.filesRestored++;
          if (existed) results.filesOverwritten++;
        } catch (fileErr) {
          results.errors.push(`${file.filename}: ${fileErr.message}`);
        }
      }
    }

    const modeLabel = mode === 'overwrite' ? 'Overwrite' : 'Merge';
    res.json({
      message: `${modeLabel} restore complete. Config: ${results.configRestored ? 'yes' : 'no'}, Files: ${results.filesRestored} restored, ${results.filesSkipped} skipped.`,
      ...results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/keyserver/keys/batch-delete - Delete multiple config files at once
router.post('/keys/batch-delete', authenticateToken, isAdmin, (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'filenames array is required' });
    }

    const config = loadConfig();
    const configDir = config.configDir || DEFAULT_CONFIG.configDir;
    const results = { deleted: 0, notFound: 0, errors: [] };

    for (const filename of filenames) {
      try {
        const sanitized = path.basename(filename);
        const filePath = path.join(configDir, sanitized);
        if (!fs.existsSync(filePath)) {
          results.notFound++;
          continue;
        }
        fs.unlinkSync(filePath);
        // Also remove companion .meta.json if present
        try { const metaPath = filePath + '.meta.json'; if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath); } catch (_) {}
        // Remove token mapping
        removeTokenForFile(sanitized);
        results.deleted++;
      } catch (err) {
        results.errors.push(`${filename}: ${err.message}`);
      }
    }

    res.json({
      message: `Deleted ${results.deleted} file(s), ${results.notFound} not found.`,
      ...results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto-start key server if configured
const config = loadConfig();
if (config.autoStart && config.secretKey) {
  setTimeout(() => {
    startKeyServer(config).catch(err => {
      console.error('[KeyServer] Auto-start failed:', err.message);
    });
  }, 2000);
}

module.exports = router;
