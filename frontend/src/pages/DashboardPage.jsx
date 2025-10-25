import { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FaServer, FaUsers, FaCheckCircle, FaExclamationTriangle, FaTimesCircle, FaNetworkWired, FaGlobe, FaLeaf, FaCube, FaInfinity, FaChartPie, FaUserShield, FaChartBar, FaChevronDown } from 'react-icons/fa';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';

function DashboardPage() {
  const [servers, setServers] = useState([]);
  const [usersByServer, setUsersByServer] = useState({}); // serverId -> users array (legacy for counts)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backendTotals, setBackendTotals] = useState({ tiers: null, status: null, totalUsers: null, totalServers: null });
  const [statusModal, setStatusModal] = useState({ open: false, type: null });
  const [statusModalData, setStatusModalData] = useState({ loading: false, users: [], error: '' });
  const [tierModal, setTierModal] = useState({ open: false, tier: null });
  const [tierModalData, setTierModalData] = useState({ loading: false, users: [], error: '' });
  const { token } = useAuth();

  const backendOrigin = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) ? 'http://localhost:3001' : '';

  const fetchAll = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError('');
      const res = await axios.get(`${backendOrigin}/api/servers/summary`, { headers: { Authorization: `Bearer ${token}` } });
      const data = res.data || {};
      setServers(Array.isArray(data.servers) ? data.servers : []);
      // create a lightweight usersByServer-like map with counts only
      const counts = {};
      (data.servers || []).forEach(s => { counts[s.id] = { length: s.total_users || 0 }; });
      setUsersByServer(counts);
      // store backend totals if available
      setBackendTotals({
        tiers: data.tiers || null,
        status: data.status || null,
        totalUsers: typeof data.totalUsers === 'number' ? data.totalUsers : null,
        totalServers: typeof data.totalServers === 'number' ? data.totalServers : null,
      });
    } catch (e) {
      console.error('Dashboard fetch failed:', e);
      setError('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [token, backendOrigin]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Normalize service names to canonical labels used across UI
  const normalizeService = useCallback((s) => {
    const t = String(s || '').trim().toLowerCase();
    if (t.startsWith('mini')) return 'Mini';
    if (t.startsWith('basic')) return 'Basic';
    if (t.startsWith('unlimited') || t === 'ul' || t.startsWith('vip')) return 'Unlimited';
    // Fallback: title-case
    return t ? (t[0].toUpperCase() + t.slice(1)) : '';
  }, []);

  const stats = useMemo(() => {
    const totalServers = backendTotals.totalServers ?? servers.length;
    const totalUsers = backendTotals.totalUsers ?? (servers || []).reduce((acc, s) => acc + (s.total_users || 0), 0);
    const mini = backendTotals.tiers?.Mini ?? 0;
    const basic = backendTotals.tiers?.Basic ?? 0;
    const unlimited = backendTotals.tiers?.Unlimited ?? 0;
    const active = backendTotals.status?.active ?? 0;
    const soon = backendTotals.status?.soon ?? 0;
    const expired = backendTotals.status?.expired ?? 0;
    return { totalServers, totalUsers, mini, basic, unlimited, active, soon, expired };
  }, [servers, backendTotals]);

  const [statusCollapsed, setStatusCollapsed] = useState(true);

  // Lightweight SVG donut renderer (no external deps)
  const DonutChart = ({ title, icon: HeaderIcon, segments, total, centerLabel, onSegmentClick, disableClickLabels = [] }) => {
    const size = 140; // viewBox logical size (SVG scales via CSS)
    const radius = 56;
    const cx = size / 2;
    const cy = size / 2;
    const stroke = 16;
    const circumference = 2 * Math.PI * radius;
    let offset = 0; // cumulative offset
    const safeTotal = total > 0 ? total : 0;
  const [hover, setHover] = useState({ show: false, x: 0, y: 0, w: size, h: size, label: '', value: 0, pct: 0 });

    return (
      <div className="infographic-card">
        <div className="chart" aria-label={title} role="img" onMouseLeave={() => setHover(h => ({ ...h, show: false }))}>
          <svg className="donut-svg" width="100%" height="100%" viewBox={`0 0 ${size} ${size}`}>
            {/* background ring */}
            <circle className="bg" cx={cx} cy={cy} r={radius} fill="transparent" strokeWidth={stroke} />
            {safeTotal > 0 && segments.map((seg, idx) => {
              const value = Math.max(0, seg.value || 0);
              const length = (value / safeTotal) * circumference;
              const clickable = onSegmentClick && !disableClickLabels.includes(seg.label);
              const circle = (
                <circle
                  key={idx}
                  cx={cx}
                  cy={cy}
                  r={radius}
                  fill="transparent"
                  stroke={seg.color}
                  strokeWidth={stroke}
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  style={{ cursor: clickable ? 'pointer' : 'default' }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    const pct = safeTotal > 0 ? Math.round((value / safeTotal) * 100) : 0;
                    setHover({ show: true, x, y, w: rect.width, h: rect.height, label: seg.label, value, pct });
                  }}
                  onMouseMove={(e) => {
                    if (!hover.show) return;
                    const rect = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const y = e.clientY - rect.top;
                    setHover(h => ({ ...h, x, y, w: rect.width, h: rect.height }));
                  }}
                  onClick={() => { if (clickable) onSegmentClick(seg.label, seg); }}
                />
              );
              offset += length;
              return circle;
            })}
          </svg>
          <div className="donut-center">
            <div className="donut-center-top">{centerLabel || ''}</div>
            <div className="donut-center-value">{safeTotal}</div>
          </div>
          {hover.show && (
            <div className="chart-tooltip" style={{ left: Math.min(Math.max(0, hover.x + 10), Math.max(0, hover.w - 10)), top: Math.min(Math.max(0, hover.y + 10), Math.max(0, hover.h - 10)) }}>
              <div className="tt-label">{hover.label}</div>
              <div className="tt-values"><strong>{hover.value}</strong> <span>• {hover.pct}%</span></div>
            </div>
          )}
        </div>
        <div className="legend">
            <div className="legend-title">
              {HeaderIcon ? <HeaderIcon className="legend-icon" aria-hidden="true" /> : null}
              <span className="legend-text">{title}</span>
              <span className="legend-rule" aria-hidden="true" />
            </div>
            <ul>
              {segments.map(seg => {
                const pct = safeTotal > 0 ? Math.round((Math.max(0, seg.value || 0) / safeTotal) * 100) : 0;
                return (
                  <li key={seg.label}>
                    <span className="legend-color" style={{ background: seg.color }} aria-hidden="true" />
                    <span className="legend-label">{seg.label}</span>
                    <span className="legend-metrics"><span className="legend-value">{seg.value}</span><span className="legend-percent"> ({pct}%)</span></span>
                  </li>
                );
              })}
            </ul>
          </div>
      </div>
    );
  };

  const openStatusModal = async (type) => {
    const fallback = async () => {
      // Fallback path: fetch users per server and filter client-side (avoids backend 404 during restart)
      const srvRes = await axios.get(`${backendOrigin}/api/servers`, { headers: { Authorization: `Bearer ${token}` } });
      const list = Array.isArray(srvRes.data) ? srvRes.data : (srvRes.data?.servers || []);
      const byId = new Map(list.map(s => [s.id, s]));
      const reqs = list.map(s => axios.get(`${backendOrigin}/api/users/server/${s.id}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => ({ id: s.id, users: Array.isArray(r.data) ? r.data : [] })).catch(() => ({ id: s.id, users: [] })));
      const results = await Promise.all(reqs);
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const filtered = [];
      for (const { id, users } of results) {
        const s = byId.get(id);
        for (const u of users) {
          const exp = u?.expire_date ? new Date(u.expire_date) : null;
          if (!exp) continue;
          const isExpired = exp < now;
          const isSoon = exp >= now && exp <= soonCutoff;
          const isActive = exp > soonCutoff;
          if ((type === 'expired' && isExpired) || (type === 'soon' && isSoon) || (type === 'active' && isActive)) {
            filtered.push({ ...u, server_name: s?.server_name, ip_address: s?.ip_address, domain_name: s?.domain_name });
          }
        }
      }
      return filtered.sort((a, b) => new Date(a.expire_date) - new Date(b.expire_date));
    };

    try {
      setStatusModal({ open: true, type, serverId: null, serverName: null });
      setStatusModalData({ loading: true, users: [], error: '' });
      const res = await axios.get(`${backendOrigin}/api/users/by-status/${type}`, { headers: { Authorization: `Bearer ${token}` } });
      setStatusModalData({ loading: false, users: Array.isArray(res.data) ? res.data : [], error: '' });
    } catch (e) {
      // If route is not found yet (server not restarted), try fallback client aggregation
      if (e?.response?.status === 404) {
        try {
          const users = await fallback();
          setStatusModalData({ loading: false, users, error: '' });
          return;
        } catch (e2) {
          setStatusModalData({ loading: false, users: [], error: e2?.message || 'Failed to load' });
          return;
        }
      }
      setStatusModalData({ loading: false, users: [], error: e?.response?.data?.msg || e?.message || 'Failed to load' });
    }
  };

  // Open Tier modal by aggregating users client-side by service type
  const openTierModal = async (tier) => {
    const normTier = normalizeService(tier);
    try {
      setTierModal({ open: true, tier: normTier });
      setTierModalData({ loading: true, users: [], error: '' });
      // Fetch all servers then fetch users per server and filter by tier
      const srvRes = await axios.get(`${backendOrigin}/api/servers`, { headers: { Authorization: `Bearer ${token}` } });
      const list = Array.isArray(srvRes.data) ? srvRes.data : (srvRes.data?.servers || []);
      const byId = new Map(list.map(s => [s.id, s]));
      const reqs = list.map(s => (
        axios.get(`${backendOrigin}/api/users/server/${s.id}`, { headers: { Authorization: `Bearer ${token}` } })
          .then(r => ({ id: s.id, users: Array.isArray(r.data) ? r.data : [] }))
          .catch(() => ({ id: s.id, users: [] }))
      ));
      const results = await Promise.all(reqs);
      const users = [];
      for (const { id, users: arr } of results) {
        const s = byId.get(id);
        for (const u of arr) {
          if (normalizeService(u?.service_type) === normTier) {
            users.push({ ...u, server_name: s?.server_name });
          }
        }
      }
      users.sort((a, b) => new Date(a.expire_date) - new Date(b.expire_date));
      setTierModalData({ loading: false, users, error: '' });
    } catch (e) {
      setTierModalData({ loading: false, users: [], error: e?.message || 'Failed to load' });
    }
  };

  // Server-scoped status modal (client-side filter per server)
  const openServerStatusModal = async (serverId, serverName, type) => {
    try {
      setStatusModal({ open: true, type, serverId, serverName });
      setStatusModalData({ loading: true, users: [], error: '' });
      const r = await axios.get(`${backendOrigin}/api/users/server/${serverId}`, { headers: { Authorization: `Bearer ${token}` } });
      const list = Array.isArray(r.data) ? r.data : [];
      const now = new Date();
      const soonCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const filtered = list.filter(u => {
        const exp = u?.expire_date ? new Date(u.expire_date) : null;
        if (!exp) return false;
        const isExpired = exp < now;
        const isSoon = exp >= now && exp <= soonCutoff;
        const isActive = exp > soonCutoff;
        return (type === 'expired' && isExpired) || (type === 'soon' && isSoon) || (type === 'active' && isActive);
      });
      setStatusModalData({ loading: false, users: filtered, error: '' });
    } catch (e) {
      setStatusModalData({ loading: false, users: [], error: e?.message || 'Failed to load' });
    }
  };

  if (loading) return <div className="app-container">Loading dashboard…</div>;
  if (error) return <div className="app-container">{error}</div>;

  return (
    <div className="app-container">
      <div className="admin-header" style={{ marginBottom: '1.25rem' }}>
        <div className="admin-header-left">
          <div className="admin-header-icon"><FaServer /></div>
          <div>
            <h2 className="admin-title" style={{ margin: 0 }}>Dashboard</h2>
            <p className="admin-subtitle" style={{ margin: 0 }}>Overview of servers and users</p>
          </div>
        </div>
      </div>

      {/* Stats banner */}
      {/* Top layout: left 4x2 banners, right 2 donuts stacked */}
      <div className="dashboard-top-grid" style={{ marginBottom: '1.25rem' }}>
        <div className="top-left">
          <div className="stats-banner stats-2x4">
            <div className="stat-card"><FaServer /><div><span>Total Servers</span><strong>{stats.totalServers}</strong></div></div>
            <div className="stat-card"><FaUsers /><div><span>Total Users</span><strong>{stats.totalUsers}</strong></div></div>
            <div className="stat-card"><FaUsers /><div><span>Mini</span><strong>{stats.mini}</strong></div></div>
            <div className="stat-card"><FaUsers /><div><span>Basic</span><strong>{stats.basic}</strong></div></div>
            <div className="stat-card"><FaUsers /><div><span>Unlimited</span><strong>{stats.unlimited}</strong></div></div>
            <div className="stat-card" title="Active users">
              <FaCheckCircle className="icon-active"/>
              <div><span>Active</span><strong>{stats.active}</strong></div>
            </div>
            <button className="stat-card as-button" onClick={() => openStatusModal('soon')} title="View users expiring soon">
              <FaExclamationTriangle className="icon-soon"/>
              <div><span>Soon</span><strong>{stats.soon}</strong></div>
            </button>
            <button className="stat-card as-button" onClick={() => openStatusModal('expired')} title="View expired users">
              <FaTimesCircle className="icon-expired"/>
              <div><span>Expired</span><strong>{stats.expired}</strong></div>
            </button>
          </div>
        </div>
        <div className="top-right">
          <div className="infographics-right-stack">
            <DonutChart
              title="Service tiers"
              icon={FaChartPie}
              total={(stats.mini + stats.basic + stats.unlimited) || 0}
              centerLabel="Users"
              segments={[
                { label: 'Mini', value: stats.mini, color: '#00bfa5' },
                { label: 'Basic', value: stats.basic, color: '#0088ff' },
                { label: 'Unlimited', value: stats.unlimited, color: '#ffd700' },
              ]}
              onSegmentClick={(label) => {
                if (label === 'Mini' || label === 'Basic' || label === 'Unlimited') openTierModal(label);
              }}
            />
            <DonutChart
              title="User status"
              icon={FaUserShield}
              total={(stats.active + stats.soon + stats.expired) || 0}
              centerLabel="Users"
              segments={[
                { label: 'Active', value: stats.active, color: '#28a745' },
                { label: 'Soon', value: stats.soon, color: '#ffc107' },
                { label: 'Expired', value: stats.expired, color: '#dc3545' },
              ]}
              onSegmentClick={(label) => {
                if (label === 'Soon') openStatusModal('soon');
                if (label === 'Expired') openStatusModal('expired');
              }}
              disableClickLabels={['Active']}
            />
          </div>
        </div>
      </div>

      {/* Per-server stacked status bars (clickable) */}
      <div className="status-stacked-section" style={{ marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={`section-header ${statusCollapsed ? 'collapsed' : ''}`}
          onClick={() => setStatusCollapsed(v => !v)}
          aria-expanded={!statusCollapsed}
          aria-controls="status-bars-list"
        >
          <FaChartBar className="section-icon" aria-hidden="true" />
          <span className="section-text">Server status distribution</span>
          <span className="section-indicators" aria-hidden="true">
            <span className="ind ind-active"><FaCheckCircle className="icon-active" /> {stats.active}</span>
            <span className="ind ind-soon"><FaExclamationTriangle className="icon-soon" /> {stats.soon}</span>
            <span className="ind ind-expired"><FaTimesCircle className="icon-expired" /> {stats.expired}</span>
          </span>
          <FaChevronDown className="chevron" aria-hidden="true" />
        </button>
        {!statusCollapsed && (
        <div id="status-bars-list" className="status-bars-list">
          {(servers || []).map(s => {
            const a = s.status?.active ?? 0; const so = s.status?.soon ?? 0; const ex = s.status?.expired ?? 0; const total = (a + so + ex) || 0;
            const pA = total ? Math.round((a / total) * 100) : 0;
            const pS = total ? Math.round((so / total) * 100) : 0;
            const pE = Math.max(0, 100 - pA - pS);
            const leftSoon = pA;
            const leftExpired = pA + pS;
            return (
              <div key={s.id} className="status-bar-row">
                <div className="status-bar-meta">
                  <div className="sb-name" title={s.server_name}>{s.server_name || '—'}</div>
                  <div className="sb-counts">
                    <span className="ind ind-active"><FaCheckCircle className="icon-active" aria-hidden="true" /><span className="count">{a}</span></span>
                    <span className="ind ind-soon"><FaExclamationTriangle className="icon-soon" aria-hidden="true" /><span className="count">{so}</span></span>
                    <span className="ind ind-expired"><FaTimesCircle className="icon-expired" aria-hidden="true" /><span className="count">{ex}</span></span>
                  </div>
                </div>
                <div className="status-bar" role="img" aria-label={`Active ${pA}% Soon ${pS}% Expired ${pE}%`}>
                  <span className="seg seg-active" style={{ width: `${pA}%`, left: '0%' }} />
                  <span className={`seg seg-soon ${so > 0 ? 'clickable' : ''}`} style={{ width: `${pS}%`, left: `${leftSoon}%` }} title="View users expiring soon"
                        onClick={() => { if (so > 0) openServerStatusModal(s.id, s.server_name, 'soon'); }} />
                  <span className={`seg seg-expired ${ex > 0 ? 'clickable' : ''}`} style={{ width: `${pE}%`, left: `${leftExpired}%` }} title="View expired users"
                        onClick={() => { if (ex > 0) openServerStatusModal(s.id, s.server_name, 'expired'); }} />
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      

      {/* Servers grid overview */}
      <div className="dashboard-grid">
        {(servers || []).map(s => {
          const users = usersByServer[s.id] || [];
          return (
            <Link key={s.id} to={`/servers/${s.id}`} className="dashboard-card-link">
              <div className="dashboard-card" role="link" tabIndex={0}>
                <div className="dashboard-card-title">{s.server_name || '—'}</div>
                <div className="dashboard-card-row"><FaNetworkWired /> <span>{s.ip_address || '—'}</span></div>
                <div className="dashboard-card-row"><FaGlobe /> <span>{s.domain_name || '—'}</span></div>
                <div className="chips-row">
                  <span className="chip chip-mini"><FaLeaf aria-hidden="true" /> Mini {s.tiers?.Mini ?? 0}</span>
                  <span className="chip chip-basic"><FaCube aria-hidden="true" /> Basic {s.tiers?.Basic ?? 0}</span>
                  <span className="chip chip-unlimited"><FaInfinity aria-hidden="true" /> Unlimited {s.tiers?.Unlimited ?? 0}</span>
                </div>
                <div className="chips-row">
                  <span className="chip chip-active"><FaCheckCircle className="icon-active" aria-hidden="true" /> Active {s.status?.active ?? 0}</span>
                  <span className="chip chip-soon"><FaExclamationTriangle className="icon-soon" aria-hidden="true" /> Soon {s.status?.soon ?? 0}</span>
                  <span className="chip chip-expired"><FaTimesCircle className="icon-expired" aria-hidden="true" /> Expired {s.status?.expired ?? 0}</span>
                </div>
                <div className="dashboard-card-foot"><span>Total users</span><strong>{users.length || s.total_users || 0}</strong></div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Status Users Modal */}
      <Modal
        isOpen={statusModal.open}
        onClose={() => setStatusModal({ open: false, type: null, serverId: null, serverName: null })}
        title={
          statusModal.type === 'expired' ? (
            <>
              <FaTimesCircle className="title-icon icon-expired" aria-hidden="true" /> Expired users {statusModal.serverName ? `— ${statusModal.serverName}` : ''}
            </>
          ) : statusModal.type === 'soon' ? (
            <>
              <FaExclamationTriangle className="title-icon icon-soon" aria-hidden="true" /> Users expiring soon {statusModal.serverName ? `— ${statusModal.serverName}` : ''}
            </>
          ) : ''
        }
        className="status-users-modal"
      >
        {statusModalData.loading && <div>Loading…</div>}
        {statusModalData.error && <div className="form-error" role="alert">{statusModalData.error}</div>}
        {!statusModalData.loading && !statusModalData.error && (
          <div className="status-users-list">
            {statusModalData.users.length === 0 ? (
              <div>No users found.</div>
            ) : (
              <table className="user-table compact">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Service</th>
                    <th>Server</th>
                    <th>Expire</th>
                  </tr>
                </thead>
                <tbody>
                  {statusModalData.users.map(u => {
                    const expText = new Date(u.expire_date).toLocaleDateString('en-GB');
                    return (
                      <tr key={u.id}>
                        <td className="account-with-status">
                          {statusModal.type === 'expired' ? (
                            <FaTimesCircle className="row-status-icon icon-expired" aria-hidden="true" />
                          ) : statusModal.type === 'soon' ? (
                            <FaExclamationTriangle className="row-status-icon icon-soon" aria-hidden="true" />
                          ) : null}
                          <span>{u.account_name}</span>
                        </td>
                        <td>{u.service_type}</td>
                        <td>{u.server_name}</td>
                        <td>
                          {expText}
                          {statusModal.type === 'expired' ? (
                            <span className="status-badge expired" aria-label="Expired">Expired</span>
                          ) : statusModal.type === 'soon' ? (
                            <span className="status-badge soon" aria-label="Expiring soon">Soon</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>


      {/* Tier Users Modal */}
      <Modal
        isOpen={tierModal.open}
        onClose={() => setTierModal({ open: false, tier: null })}
        title={tierModal.tier ? `Users in ${tierModal.tier}` : ''}
        className="status-users-modal"
      >
        {tierModalData.loading && <div>Loading…</div>}
        {tierModalData.error && <div className="form-error" role="alert">{tierModalData.error}</div>}
        {!tierModalData.loading && !tierModalData.error && (
          <div className="status-users-list">
            {tierModalData.users.length === 0 ? (
              <div>No users found.</div>
            ) : (
              <table className="user-table compact">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Service</th>
                    <th>Server</th>
                    <th>Expire</th>
                  </tr>
                </thead>
                <tbody>
                  {tierModalData.users.map(u => (
                    <tr key={u.id}>
                      <td>{u.account_name}</td>
                      <td>{normalizeService(u.service_type)}</td>
                      <td>{u.server_name}</td>
                      <td>{u.expire_date ? new Date(u.expire_date).toLocaleDateString('en-GB') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default DashboardPage;

