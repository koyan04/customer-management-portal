import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  FaTimes, FaSyncAlt, FaDesktop, FaHdd, FaExchangeAlt,
  FaArrowUp, FaArrowDown, FaGlobe, FaEye, FaEyeSlash,
  FaListUl, FaDatabase, FaClock, FaCheck, FaRegCopy,
  FaPlay, FaPause, FaMicrochip, FaMemory, FaExclamationTriangle
} from 'react-icons/fa';
import { getBackendOrigin } from '../lib/backendOrigin';
import './ServerMonitorSlideOver.css';

// Helper to format bytes
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0.00 B/s';
  const k = 1024;
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
  const clampedIdx = Math.min(sizes.length - 1, Math.max(0, i));
  return `${(bytesPerSec / Math.pow(k, clampedIdx)).toFixed(2)} ${sizes[clampedIdx]}`;
}

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Mini SVG Sparkline generator
function Sparkline({ data = [], color = '#3b82f6', height = 36, showArea = true, min = 0, max = 100 }) {
  if (!data || data.length < 2) {
    return <div className="sms-sparkline-empty" style={{ height }} />;
  }

  const width = 200;
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const clampedVal = Math.max(min, Math.min(max, val));
    const range = max - min || 1;
    const y = height - ((clampedVal - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  const gradId = `grad-${color.replace('#', '')}-${Math.random().toString(36).substr(2, 6)}`;

  return (
    <svg className="sms-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {showArea && <path d={areaD} fill={`url(#${gradId})`} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Dual-Line Chart for Network & Connections
function DualLineChart({ data1 = [], data2 = [], color1 = '#3b82f6', color2 = '#94a3b8', height = 150, maxVal = null }) {
  const width = 500;
  const count = Math.max(data1.length, data2.length);
  if (count < 2) {
    return <div className="sms-chart-placeholder" style={{ height }}>Collecting telemetry samples…</div>;
  }

  const peak = maxVal || Math.max(...data1, ...data2, 1);
  const getPoints = (arr) => arr.map((val, idx) => {
    const x = (idx / (count - 1)) * width;
    const y = height - (Math.max(0, val) / peak) * (height - 18) - 9;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const p1 = getPoints(data1);
  const p2 = getPoints(data2);
  const line1D = `M ${p1.join(' L ')}`;
  const line2D = `M ${p2.join(' L ')}`;
  const area1D = `${line1D} L ${width},${height} L 0,${height} Z`;

  return (
    <svg className="sms-dual-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="area1-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color1} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color1} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="var(--sms-chart-grid, rgba(255,255,255,0.06))" strokeDasharray="3 3" />
      <line x1="0" y1={height * 0.50} x2={width} y2={height * 0.50} stroke="var(--sms-chart-grid, rgba(255,255,255,0.06))" strokeDasharray="3 3" />
      <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="var(--sms-chart-grid, rgba(255,255,255,0.06))" strokeDasharray="3 3" />

      {/* Area 1 */}
      <path d={area1D} fill="url(#area1-grad)" />

      {/* Line 2 (Secondary) */}
      <path d={line2D} fill="none" stroke={color2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />

      {/* Line 1 (Primary) */}
      <path d={line1D} fill="none" stroke={color1} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ServerMonitorSlideOver({ isOpen, onClose }) {
  const [telemetry, setTelemetry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(2000); // 2 seconds
  const [hideIp, setHideIp] = useState(false);
  const [copiedIp, setCopiedIp] = useState(false);

  // History state for charts (rolling window of 30 samples)
  const [history, setHistory] = useState({
    cpu: [15, 18, 14, 22, 19, 17, 21, 18.9],
    ram: [44.2, 44.5, 44.1, 44.8, 44.6, 44.8],
    uploadSpeed: [0.8, 1.1, 0.9, 1.4, 1.2, 1.5, 1.41],
    downloadSpeed: [1.0, 1.3, 1.1, 1.6, 1.3, 1.4, 1.42],
    tcp: [3120, 3145, 3150, 3162, 3170],
    udp: [240, 242, 245, 246, 247]
  });

  // Modal for viewing logs
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [logsContent, setLogsContent] = useState('');
  const [logsLoading, setLogsLoading] = useState(false);

  // Restart confirmation & status
  const [restarting, setRestarting] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  // Live theme detection to match app theme
  const [isLight, setIsLight] = useState(() => {
    return typeof document !== 'undefined' && document.body.classList.contains('theme-light');
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const updateTheme = () => {
      setIsLight(document.body.classList.contains('theme-light'));
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const primaryColor = isLight ? '#2563eb' : '#38bdf8';
  const secondaryColor = isLight ? '#64748b' : '#94a3b8';
  const cyanColor = isLight ? '#0d9488' : '#00e6c1';

  const backendOrigin = useMemo(() => getBackendOrigin(), []);
  const token = localStorage.getItem('token');

  // Fetch telemetry
  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await axios.get(`${backendOrigin}/api/admin/control/system-monitor`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data && res.data.ok) {
        const d = res.data;
        setTelemetry(d);
        setError('');

        // Push to rolling history
        setHistory(prev => {
          const maxSamples = 30;
          const upMB = d.network?.uploadSpeed ? d.network.uploadSpeed / (1024 * 1024) : 0;
          const downMB = d.network?.downloadSpeed ? d.network.downloadSpeed / (1024 * 1024) : 0;

          return {
            cpu: [...prev.cpu.slice(-(maxSamples - 1)), d.cpu?.percent ?? 0],
            ram: [...prev.ram.slice(-(maxSamples - 1)), d.ram?.percent ?? 0],
            uploadSpeed: [...prev.uploadSpeed.slice(-(maxSamples - 1)), parseFloat(upMB.toFixed(2))],
            downloadSpeed: [...prev.downloadSpeed.slice(-(maxSamples - 1)), parseFloat(downMB.toFixed(2))],
            tcp: [...prev.tcp.slice(-(maxSamples - 1)), d.connections?.tcp ?? 0],
            udp: [...prev.udp.slice(-(maxSamples - 1)), d.connections?.udp ?? 0]
          };
        });
      }
    } catch (err) {
      console.error('System monitor fetch error:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to connect to server monitor');
    } finally {
      setLoading(false);
    }
  }, [backendOrigin, token]);

  // Polling interval
  useEffect(() => {
    if (!isOpen || isPaused) return;

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, refreshInterval);
    return () => clearInterval(interval);
  }, [isOpen, isPaused, refreshInterval, fetchTelemetry]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        if (logsModalOpen) {
          setLogsModalOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, logsModalOpen, onClose]);

  // Handle service restart
  const handleRestartService = async () => {
    if (!window.confirm('Are you sure you want to restart the portal backend service?')) return;
    setRestarting(true);
    setActionNotice('Restarting backend service…');
    try {
      await axios.post(`${backendOrigin}/api/admin/control/service/restart`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setActionNotice('Service restart initiated. Reconnecting…');
      setTimeout(() => {
        setActionNotice('');
        setRestarting(false);
        fetchTelemetry();
      }, 3500);
    } catch (e) {
      setActionNotice(`Restart error: ${e?.response?.data?.error || e.message}`);
      setTimeout(() => { setActionNotice(''); setRestarting(false); }, 4000);
    }
  };

  // View System Logs
  const handleViewLogs = async () => {
    setLogsModalOpen(true);
    setLogsLoading(true);
    try {
      const res = await axios.get(`${backendOrigin}/api/admin/control/system-logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLogsContent(res.data?.logs || 'No log output available.');
    } catch (e) {
      setLogsContent(`Failed to fetch logs: ${e?.response?.data?.error || e.message}`);
    } finally {
      setLogsLoading(false);
    }
  };

  // Copy IP
  const handleCopyIp = (ipText) => {
    if (!ipText) return;
    navigator.clipboard.writeText(ipText);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  if (!isOpen) return null;

  // Derived metrics
  const cpu = telemetry?.cpu || { percent: 18.9, cores: 1, threads: 1, speed: '4.49 GHz', avg: 17, peak: 21 };
  const ram = telemetry?.ram || { used: 923533312, total: 2061619200, percent: 44.8, avg: 44, peak: 45 };
  const swap = telemetry?.swap || { used: 0, total: 0, percent: 0.0, avg: 0, peak: 0 };
  const storage = telemetry?.storage || { used: 4853407744, total: 21023719424, free: 16170311680, percent: 23.1 };
  const net = telemetry?.network || { uploadSpeed: 1478492, downloadSpeed: 1488977, peakSpeed: 3334471, sent: 809033302016, received: 805519183872 };
  const conn = telemetry?.connections || { total: 3417, tcp: 3170, udp: 247 };
  const uptime = telemetry?.uptime || { os: 356400, app: 356400 };
  const panel = telemetry?.panel || { ram: 182845440, threads: 36 };
  const ipAddress = telemetry?.ip || '127.0.0.1';

  // Calculate window averages for speed
  const avgUpWindow = history.uploadSpeed.length
    ? (history.uploadSpeed.reduce((a, b) => a + b, 0) / history.uploadSpeed.length).toFixed(2)
    : '1.51';
  const avgDownWindow = history.downloadSpeed.length
    ? (history.downloadSpeed.reduce((a, b) => a + b, 0) / history.downloadSpeed.length).toFixed(2)
    : '1.53';

  if (!isOpen) return null;

  const content = (
    <div className="sms-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="sms-slideover" role="dialog" aria-modal="true" aria-label="Server Monitor">
        {/* Slide-over Header Bar */}
        <div className="sms-header">
          <div className="sms-header-left">
            <div className="sms-icon-wrap"><FaDesktop /></div>
            <div>
              <h2 className="sms-title">Server Monitor</h2>
              <div className="sms-subtitle">Real-time system telemetry & host resources</div>
            </div>
          </div>

          <div className="sms-header-actions">
            <div className="sms-live-indicator" title={isPaused ? 'Telemetry paused' : 'Live polling active'}>
              <span className={`sms-pulse-dot ${isPaused ? 'paused' : ''}`} />
              <span className="sms-live-text">{isPaused ? 'Paused' : 'Live'}</span>
            </div>

            <button
              className="sms-control-btn"
              onClick={() => setIsPaused(p => !p)}
              title={isPaused ? 'Resume polling' : 'Pause polling'}
            >
              {isPaused ? <FaPlay /> : <FaPause />}
            </button>

            <button
              className="sms-control-btn"
              onClick={fetchTelemetry}
              title="Manual refresh"
              disabled={loading}
            >
              <FaSyncAlt className={loading ? 'sms-spinning' : ''} />
            </button>

            <button className="sms-close-btn" onClick={onClose} title="Close monitor (Esc)">
              <FaTimes />
            </button>
          </div>
        </div>

        {/* Action Notice banner */}
        {actionNotice && (
          <div className="sms-notice-banner">{actionNotice}</div>
        )}

        {/* Scrollable Monitor Content */}
        <div className="sms-body">
          {/* Top Status & Controls Strip */}
          <div className="sms-status-bar">
            <div className="sms-service-pill">
              <span className="sms-green-dot" />
              <span className="sms-service-name">{telemetry?.service?.name || 'Customer Management Portal'} · Running</span>
              <span className="sms-badge-ver">{telemetry?.service?.version || 'v1.9.15'}</span>
              <span className="sms-badge-node">{telemetry?.service?.nodeVersion || 'v22'}</span>
            </div>

            <div className="sms-quick-actions">
              <button
                className="sms-action-btn primary"
                onClick={handleRestartService}
                disabled={restarting}
                title="Restart CMP Backend Service"
              >
                <FaSyncAlt className={restarting ? 'sms-spinning' : ''} /> Restart
              </button>
              <button
                className="sms-action-btn"
                onClick={handleViewLogs}
                title="View recent backend systemd journal logs"
              >
                <FaListUl /> Logs
              </button>
            </div>
          </div>

          {error && (
            <div className="sms-error-banner">
              <FaExclamationTriangle /> {error}
            </div>
          )}

          {/* 4 Core Stat Cards */}
          <div className="sms-cards-grid">
            {/* Card 1: CPU */}
            <div className="sms-stat-card">
              <div className="sms-card-header">
                <div className="sms-card-label">
                  <FaMicrochip className="sms-card-icon" /> CPU
                </div>
              </div>
              <div className="sms-card-main-val">
                {cpu.percent.toFixed(1)}<span className="sms-unit">%</span>
              </div>
              <div className="sms-card-sub">
                {cpu.cores} Core / {cpu.threads}T {cpu.speed ? `· ${cpu.speed}` : ''}
              </div>
              <div className="sms-card-footer">
                <span>AVG {cpu.avg}%</span>
                <span>PEAK {cpu.peak}%</span>
              </div>
              <div className="sms-sparkline-box">
                <Sparkline data={history.cpu} color={primaryColor} height={38} max={100} />
              </div>
            </div>

            {/* Card 2: RAM */}
            <div className="sms-stat-card">
              <div className="sms-card-header">
                <div className="sms-card-label">
                  <FaMemory className="sms-card-icon" /> RAM
                </div>
              </div>
              <div className="sms-card-main-val">
                {ram.percent.toFixed(1)}<span className="sms-unit">%</span>
              </div>
              <div className="sms-card-sub">
                {formatBytes(ram.used)} / {formatBytes(ram.total)}
              </div>
              <div className="sms-card-footer">
                <span>AVG {ram.avg}%</span>
                <span>PEAK {ram.peak}%</span>
              </div>
              <div className="sms-sparkline-box">
                <Sparkline data={history.ram} color={primaryColor} height={38} max={100} />
              </div>
            </div>

            {/* Card 3: SWAP */}
            <div className="sms-stat-card">
              <div className="sms-card-header">
                <div className="sms-card-label">
                  <FaExchangeAlt className="sms-card-icon" /> SWAP
                </div>
              </div>
              <div className="sms-card-main-val">
                {swap.percent.toFixed(1)}<span className="sms-unit">%</span>
              </div>
              <div className="sms-card-sub">
                {formatBytes(swap.used)} / {formatBytes(swap.total)}
              </div>
              <div className="sms-card-footer">
                <span>AVG {swap.avg}%</span>
                <span>PEAK {swap.peak}%</span>
              </div>
              <div className="sms-sparkline-box">
                <div className="sms-sparkline-flat" />
              </div>
            </div>

            {/* Card 4: STORAGE */}
            <div className="sms-stat-card">
              <div className="sms-card-header">
                <div className="sms-card-label">
                  <FaHdd className="sms-card-icon" /> STORAGE
                </div>
              </div>
              <div className="sms-card-main-val">
                {storage.percent.toFixed(1)}<span className="sms-unit">%</span>
              </div>
              <div className="sms-card-sub">
                {formatBytes(storage.used)} / {formatBytes(storage.total)}
              </div>
              <div className="sms-card-footer">
                <span>FREE {formatBytes(storage.free)}</span>
                <span>AVG {storage.percent}%</span>
              </div>
              <div className="sms-storage-progress-bar">
                <div className="sms-storage-fill" style={{ width: `${Math.min(100, storage.percent)}%` }} />
              </div>
            </div>
          </div>

          {/* Middle Charts Section (Overall Speed & Connection Stats) */}
          <div className="sms-mid-grid">
            {/* Left: Overall Speed */}
            <div className="sms-chart-card">
              <div className="sms-chart-header">
                <div>
                  <div className="sms-chart-title">OVERALL SPEED</div>
                  <div className="sms-chart-subtitle">
                    Interface total · peak {formatSpeed(net.peakSpeed)}
                  </div>
                </div>
                <div className="sms-speed-badges">
                  <span className="sms-speed-badge upload">
                    <FaArrowUp /> Upload <strong>{formatSpeed(net.uploadSpeed)}</strong>
                  </span>
                  <span className="sms-speed-badge download">
                    <FaArrowDown /> Download <strong>{formatSpeed(net.downloadSpeed)}</strong>
                  </span>
                </div>
              </div>

              <div className="sms-chart-canvas-wrap">
                <DualLineChart
                  data1={history.uploadSpeed}
                  data2={history.downloadSpeed}
                  color1={cyanColor}
                  color2={primaryColor}
                  height={150}
                />
              </div>

              <div className="sms-chart-footer">
                <div>
                  <div className="sms-foot-label">SENT</div>
                  <div className="sms-foot-val">{formatBytes(net.sent)}</div>
                </div>
                <div>
                  <div className="sms-foot-label">RECEIVED</div>
                  <div className="sms-foot-val">{formatBytes(net.received)}</div>
                </div>
                <div>
                  <div className="sms-foot-label">AVG OVER WINDOW</div>
                  <div className="sms-foot-val">
                    ↑ {avgUpWindow} MB/s &nbsp; ↓ {avgDownWindow} MB/s
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Connection Stats */}
            <div className="sms-chart-card">
              <div className="sms-chart-header">
                <div>
                  <div className="sms-chart-title">CONNECTION STATS</div>
                  <div className="sms-socket-count">
                    <strong>{conn.total}</strong> open sockets
                  </div>
                </div>
                <div className="sms-conn-legend">
                  <span className="sms-legend-item tcp">
                    <span className="sms-legend-line tcp" /> TCP {conn.tcp.toLocaleString()}
                  </span>
                  <span className="sms-legend-item udp">
                    <span className="sms-legend-line udp" /> UDP {conn.udp.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="sms-chart-canvas-wrap">
                <DualLineChart
                  data1={history.tcp}
                  data2={history.udp}
                  color1={primaryColor}
                  color2={secondaryColor}
                  height={150}
                />
              </div>
            </div>
          </div>

          {/* Bottom System Info Bar */}
          <div className="sms-bottom-bar">
            {/* Uptime */}
            <div className="sms-info-item">
              <div className="sms-info-header">
                <FaClock className="sms-info-icon" /> UPTIME
              </div>
              <div className="sms-info-stats">
                <div>
                  <span className="sms-lbl">CMP</span>
                  <span className="sms-val">{formatUptime(uptime.app)}</span>
                </div>
                <div>
                  <span className="sms-lbl">OS</span>
                  <span className="sms-val">{formatUptime(uptime.os)}</span>
                </div>
              </div>
            </div>

            {/* Panel */}
            <div className="sms-info-item">
              <div className="sms-info-header">
                <FaDesktop className="sms-info-icon" /> PANEL
              </div>
              <div className="sms-info-stats">
                <div>
                  <span className="sms-lbl">RAM</span>
                  <span className="sms-val">{formatBytes(panel.ram)}</span>
                </div>
                <div>
                  <span className="sms-lbl">THREADS</span>
                  <span className="sms-val">{panel.threads}</span>
                </div>
              </div>
            </div>

            {/* IP Addresses */}
            <div className="sms-info-item ip-col">
              <div className="sms-info-header">
                <FaGlobe className="sms-info-icon" /> IP ADDRESSES
                <button
                  type="button"
                  className="sms-ip-toggle-btn"
                  onClick={() => setHideIp(h => !h)}
                  title={hideIp ? 'Show IP' : 'Hide IP for privacy'}
                >
                  {hideIp ? <FaEye /> : <FaEyeSlash />}
                </button>
              </div>
              <div className="sms-ip-display">
                <span className={`sms-ip-text ${hideIp ? 'masked' : ''}`}>
                  {hideIp ? '•••.•••.•••.•••' : ipAddress}
                </span>
                <button
                  type="button"
                  className="sms-copy-ip-btn"
                  onClick={() => handleCopyIp(ipAddress)}
                  title={copiedIp ? 'Copied!' : 'Copy IP address'}
                >
                  {copiedIp ? <FaCheck /> : <FaRegCopy />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Embedded Logs Modal */}
        {logsModalOpen && (
          <div className="sms-logs-modal-backdrop" onClick={() => setLogsModalOpen(false)}>
            <div className="sms-logs-modal" onClick={e => e.stopPropagation()}>
              <div className="sms-logs-header">
                <h3><FaListUl /> Recent Service Logs</h3>
                <div className="sms-logs-actions">
                  <button className="sms-control-btn" onClick={handleViewLogs} title="Refresh logs">
                    <FaSyncAlt className={logsLoading ? 'sms-spinning' : ''} />
                  </button>
                  <button className="sms-close-btn" onClick={() => setLogsModalOpen(false)}>
                    <FaTimes />
                  </button>
                </div>
              </div>
              <div className="sms-logs-body">
                {logsLoading ? (
                  <div className="sms-logs-loading">Loading system journal logs…</div>
                ) : (
                  <pre className="sms-logs-pre">{logsContent}</pre>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
