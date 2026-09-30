// Host/server telemetry rendered as a compact Telegram card.
// Kept separate from telegram_bot.js so the formatting is unit-testable and
// the bot file stays focused on navigation.

const os = require('os');
const fs = require('fs');
const path = require('path');

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 1024-based units, matching how VPS providers report traffic.
function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const val = n / Math.pow(1024, i);
  return `${val.toFixed(2)} ${units[i]}`;
}

// Compact human uptime: "2 Days", "3 Hours 12 Min", "45 Sec"
function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return h > 0 ? `${d} Days ${h} Hours` : `${d} Days`;
  if (h > 0) return m > 0 ? `${h} Hours ${m} Min` : `${h} Hours`;
  if (m > 0) return `${m} Min ${sec} Sec`;
  return `${sec} Sec`;
}

// Shorten IPv6 for display; a full 200-char address is unreadable in a chat.
function shortIpv6(addr) {
  const a = String(addr || '').trim();
  if (!a) return '';
  if (a.length <= 39) return a;
  return `${a.slice(0, 24)}…${a.slice(-9)}`;
}

function readVersion() {
  try {
    const p = path.resolve(__dirname, '..', '..', 'VERSION');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch (_) {}
  return '';
}

// Normalise "cmp ver 1.9.29" / "1.9.29" / "v1.9.29" down to "1.9.29" so the
// card shows the same number the portal footer and /api/health report, rather
// than a second, divergent version string.
function shortVersion(raw) {
  const v = String(raw || '').trim();
  if (!v) return 'N/A';
  const m = v.match(/(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : v;
}

function getHostId() {
  try {
    if (fs.existsSync('/etc/machine-id')) {
      const id = fs.readFileSync('/etc/machine-id', 'utf8').trim();
      if (id) return `srv${id.replace(/-/g, '').slice(0, 12)}`;
    }
  } catch (_) {}
  return `srv${os.hostname().replace(/[^a-z0-9]/gi, '').slice(0, 10)}`;
}

function readRam() {
  const total = os.totalmem();
  const free = os.freemem();
  return { used: total - free, total };
}

function readLoad() {
  const l = os.loadavg();
  return [Number(l[0] || 0), Number(l[1] || 0), Number(l[2] || 0)];
}

function readSockets() {
  let tcp = 0;
  let udp = 0;
  try {
    if (fs.existsSync('/proc/net/sockstat')) {
      const data = fs.readFileSync('/proc/net/sockstat', 'utf8');
      const t = data.match(/TCP:\s+inuse\s+(\d+)/);
      const u = data.match(/UDP:\s+inuse\s+(\d+)/);
      if (t) tcp = parseInt(t[1], 10);
      if (u) udp = parseInt(u[1], 10);
    }
  } catch (_) {}
  return { tcp, udp };
}

// Total traffic since boot, summed across all non-loopback interfaces.
function readTraffic() {
  let rx = 0;
  let tx = 0;
  try {
    if (fs.existsSync('/proc/net/dev')) {
      const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n');
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('lo:')) continue;
        const parts = line.replace(/.*:/, '').trim().split(/\s+/);
        if (parts.length >= 9) {
          rx += parseInt(parts[0], 10) || 0;
          tx += parseInt(parts[8], 10) || 0;
        }
      }
    }
  } catch (_) {}
  return { rx, tx };
}

function listAddresses() {
  const v4 = [];
  const v6 = [];
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const it of ifaces[name] || []) {
      if (it.internal) continue;
      if (it.family === 'IPv4' || it.family === 4) v4.push(it.address);
      else if (it.family === 'IPv6' || it.family === 6) {
        // Skip link-local (fe80::) — not routable, just noise in a chat card.
        if (!String(it.address).toLowerCase().startsWith('fe80')) v6.push(it.address);
      }
    }
  }
  return { v4, v6 };
}

// Build the host info card text.
// `serviceState` lets the caller report a real systemd state when available.
function renderHostInfo(opts = {}) {
  const serviceState = opts.serviceState || 'running';
  const ram = readRam();
  const load = readLoad();
  const sock = readSockets();
  const net = readTraffic();
  const addr = listAddresses();
  const ver = shortVersion(readVersion());

  const total = net.rx + net.tx;
  const L = [];
  L.push(`💻 Host: <code>${escapeHtml(getHostId())}</code>`);
  L.push(`📡 CMP Version: ${escapeHtml(ver)}`);
  L.push(`🌐 IPv4: ${addr.v4.length ? addr.v4.map(a => `<code>${escapeHtml(a)}</code>`).join(' ') : '<i>none</i>'}`);
  L.push(`🌐 IPv6: ${addr.v6.length ? addr.v6.map(a => `<code>${escapeHtml(shortIpv6(a))}</code>`).join(' ') : '<i>none</i>'}`);
  L.push(`⏳ Uptime: ${formatUptime(os.uptime())}`);
  L.push(`📈 System Load: ${load.map(n => n.toFixed(2)).join(', ')}`);
  L.push(`📋 RAM: ${formatBytes(ram.used)}/${formatBytes(ram.total)}`);
  L.push(`🔹 TCP: ${sock.tcp}`);
  L.push(`🔸 UDP: ${sock.udp}`);
  L.push(`🚦 Traffic: ${formatBytes(total)} (↑${formatBytes(net.tx)},↓${formatBytes(net.rx)})`);
  L.push(`ℹ️ Status: ${escapeHtml(serviceState)}`);
  return L.join('\n');
}

// Live uptime of the bot process itself, useful for the refresh toast.
function formatAppUptime(seconds) {
  return formatUptime(seconds);
}

module.exports = { renderHostInfo, formatBytes, formatUptime, shortVersion, formatAppUptime };
