import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import AdminEditorForm from '../components/AdminEditorForm.jsx';
import { FaTrashAlt, FaUserPlus, FaTools, FaSearch, FaInfoCircle, FaHistory } from 'react-icons/fa';
import MatviewStatus from '../components/MatviewStatus.jsx';
import Modal from '../components/Modal.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import formatWithAppTZ, { isSameDayInAppTZ } from '../lib/timezone';
import { getBackendOrigin } from '../lib/backendOrigin';
import TopProgressBar from '../components/TopProgressBar.jsx';

function AdminPanelPage() {
  const { token, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logsModal, setLogsModal] = useState({ open: false, account: null, logs: [], loading: false });
  const [accounts, setAccounts] = useState([]);
  const [servers, setServers] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 8;

  // Fetch accounts function (reusable)
  const fetchAccounts = async () => {
    try {
      const r = await axios.get('/api/admin/accounts', { headers: { Authorization: `Bearer ${token}` } });
      const d = r.data;
      const normalized = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : (d && Array.isArray(d.accounts) ? d.accounts : []));
      setAccounts(normalized);
      return normalized;
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
      return null;
    }
  };

  // Initial load
  useEffect(() => {
    if (!token) return;
    (async () => {
      setLoading(true);
      try {
        await fetchAccounts();
      } catch (err) {
        console.error(err);
      }

      // normalize servers response to always be an array
      try {
        const backendOrigin = getBackendOrigin();
        const rs = await axios.get(backendOrigin + '/api/servers', { headers: { Authorization: `Bearer ${token}` } });
        const d2 = rs.data;
        const normalized2 = Array.isArray(d2) ? d2 : (d2 && Array.isArray(d2.data) ? d2.data : (d2 && Array.isArray(d2.servers) ? d2.servers : []));
        setServers(normalized2);
      } catch (err) {
        console.error('Failed to fetch servers with backend origin', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Real-time polling for online status (every 30 seconds)
  useEffect(() => {
    if (!token) return;
    
    const pollInterval = setInterval(async () => {
      // Silently update accounts to refresh online status
      await fetchAccounts();
    }, 10000); // 10 seconds for more responsive status updates

    return () => clearInterval(pollInterval);
  }, [token]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [highlightId, setHighlightId] = useState(null);

  const reload = (highlightForId = null) => {
    // Clear caches to force fresh data fetch
    setServerAdminCounts({});
    setLastSeenMap({});
    
    axios.get('/api/admin/accounts', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        const d = r.data;
        const normalized = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : (d && Array.isArray(d.accounts) ? d.accounts : []));
        setAccounts(normalized);
        // bump refreshTick to bust avatar cache on the UI
        setRefreshTick(t => t + 1);
        // if we were editing an account, refresh the editing object so the modal shows updated avatar/url
        setEditing(prev => {
          if (!prev || !prev.id) return prev;
          const updated = normalized.find(x => x.id === prev.id);
          return updated || prev;
        });
        if (highlightForId) {
          setHighlightId(highlightForId);
          setTimeout(() => setHighlightId(null), 1400);
        }
      })
      .catch(console.error);
  };

  // Ensure we always work with an array even if the API returns an object or unexpected shape
  const accountsList = useMemo(() => (
    Array.isArray(accounts)
      ? accounts
      : (accounts && Array.isArray(accounts.data) ? accounts.data : (accounts && Array.isArray(accounts.accounts) ? accounts.accounts : []))
  ), [accounts]);

  const filteredAndPaged = useMemo(() => {
    const filtered = accountsList.filter(a => (a.display_name || '').toLowerCase().includes(query.toLowerCase()) || (a.username || '').toLowerCase().includes(query.toLowerCase()));
    const start = (page - 1) * perPage;
    return filtered.slice(start, start + perPage);
  }, [accountsList, query, page, perPage]);

  // helper to fetch server-admin count for an account; cache locally to avoid spamming
  const [serverAdminCounts, setServerAdminCounts] = useState({});
  const [lastSeenMap, setLastSeenMap] = useState({}); // { [adminId]: { ts: string, location?: string, ip?: string } }
  useEffect(() => {
    // fetch counts for visible accounts on the current page
    (async () => {
      try {
        const idsToFetch = filteredAndPaged.filter(a => a && a.id).map(a => a.id).filter(id => typeof serverAdminCounts[id] === 'undefined');
        if (!idsToFetch.length) return;
        const backendOrigin = getBackendOrigin();
        // fetch per-admin server-admin list in parallel
        const promises = idsToFetch.map(id => axios.get(backendOrigin + `/api/admin/server-admins/${id}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: { server_ids: [] } })) );
        const results = await Promise.all(promises);
        const updates = {};
        idsToFetch.forEach((id, i) => {
          const data = results[i]?.data || results[i];
          const sids = Array.isArray(data) ? data : (data && data.server_ids ? data.server_ids : (data.server_admin_for || []));
          updates[id] = Array.isArray(sids) ? sids.length : 0;
        });
        setServerAdminCounts(prev => ({ ...prev, ...updates }));
      } catch (err) {
        // non-fatal; leave counts missing
        console.debug('Failed to fetch server-admin counts', err);
      }
    })();
  }, [filteredAndPaged, token, serverAdminCounts]);

  // Fetch last seen audit entry for visible accounts (one call per visible id, cached)
  useEffect(() => {
    (async () => {
      try {
        const ids = filteredAndPaged.filter(a => a && a.id).map(a => a.id).filter(id => typeof lastSeenMap[id] === 'undefined');
        if (!ids.length) return;
        const backendOrigin = getBackendOrigin();
        const reqs = ids.map(id => axios.get(backendOrigin + `/api/admin/accounts/${id}/login-audit`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] })));
        const res = await Promise.all(reqs);
        const updates = {};
        ids.forEach((id, i) => {
          const rows = Array.isArray(res[i]?.data) ? res[i].data : (Array.isArray(res[i]?.data?.rows) ? res[i].data.rows : []);
          if (rows && rows.length > 0) {
            const r0 = rows[0];
            updates[id] = { ts: r0.created_at, location: r0.location || null, ip: r0.ip || null };
          } else {
            updates[id] = null;
          }
        });
        setLastSeenMap(prev => ({ ...prev, ...updates }));
      } catch (e) {
        // non-fatal
      }
    })();
  }, [filteredAndPaged, token, lastSeenMap]);

  const fmtLastSeen = (iso) => {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      const now = new Date();
      const sameDay = isSameDayInAppTZ(d, now);
      return sameDay ? ('Today ' + formatWithAppTZ(d, { timeStyle: 'short' })) : formatWithAppTZ(d, { dateStyle: 'medium', timeStyle: 'short' });
    } catch (_) { return null; }
  };

  const fetchActivityLogs = async (account) => {
    setLogsModal({ open: true, account, logs: [], loading: true });
    try {
      const res = await axios.get(`/api/admin/accounts/${account.id}/activity-logs?limit=100`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Filter to only show CREATE, UPDATE, DELETE, DISABLE, and TRANSFER actions
      const filteredLogs = (res.data || []).filter(log => {
        const action = (log.action || '').toUpperCase();
        return action === 'CREATE' || action === 'UPDATE' || action === 'DELETE' || 
               action === 'DISABLE' || action === 'ENABLE' || action.includes('TRANSFER');
      });
      setLogsModal(prev => ({ ...prev, logs: filteredLogs, loading: false }));
    } catch (err) {
      console.error('Failed to fetch activity logs:', err);
      setLogsModal(prev => ({ ...prev, logs: [], loading: false }));
    }
  };

  const handleDelete = async (acct) => {
    // legacy fallback; prefer confirmation modal
    if (!acct) return;
    setDeleteTarget(acct);
  };

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Info modal state
  const [infoTarget, setInfoTarget] = useState(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [auditRows, setAuditRows] = useState([]);
  const [auditPage, setAuditPage] = useState(1);
  const auditPerPage = 5;
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditErr, setAuditErr] = useState(null);

  const openInfo = async (acct) => {
    if (!acct) return;
    setInfoTarget(acct);
    setInfoOpen(true);
    setLoadingAudit(true);
    setAuditErr(null);
    setAuditRows([]);
    try {
      const backendOrigin = getBackendOrigin();
      const r = await axios.get(backendOrigin + `/api/admin/accounts/${acct.id}/login-audit`, { headers: { Authorization: `Bearer ${token}` } });
      const rows = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.rows) ? r.data.rows : []);
      setAuditRows(rows);
    } catch (err) {
      console.error('Failed to load audit:', err);
      const msg = err.response?.data?.msg || err.message || 'Failed to load';
      setAuditErr(msg);
    } finally {
      setLoadingAudit(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await axios.delete(`/api/admin/accounts/${deleteTarget.id}`, { headers: { Authorization: `Bearer ${token}` } });
      setDeleteTarget(null);
      reload();
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.msg || err.message || 'Failed to delete';
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-panel">
      <TopProgressBar active={loading} />
      <div className="admin-header">
        <div className="admin-header-left">
          <FaTools className="admin-header-icon" aria-hidden="true" />
          <div>
            <h2 className="admin-title">Admin Panel</h2>
            <p className="admin-subtitle">Manage viewers and server permissions here.</p>
            {/* Matview status widget for admins */}
            {(user && (user.user?.role || user.role) === 'ADMIN') && (
              <div style={{ marginTop: '0.5rem' }}>
                <MatviewStatus />
              </div>
            )}
          </div>
        </div>
        <div className="admin-header-actions">
          { (user && (user.user?.role || user.role) === 'ADMIN') && (
            <button className="icon-btn add-viewer-btn" title="Add viewer" aria-label="Add viewer" onClick={() => { setEditing(null); setFormOpen(true); }}>
              <FaUserPlus />
            </button>
          ) }
          <div className="admin-search">
            <FaSearch className="search-icon" aria-hidden="true" />
            <input
              className="admin-search-input"
              placeholder="Search by name or username"
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      


      <div className="account-grid">
        <AnimatePresence>
  {filteredAndPaged.map(a => {
          const initials = (() => {
            const name = a.display_name || a.username || '';
            return name.split(' ').filter(Boolean).slice(0,2).map(n => n[0]?.toUpperCase() || '').join('') || (a.username || '').slice(0,2).toUpperCase();
          })();

          const stringToColor = (str) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
              hash = str.charCodeAt(i) + ((hash << 5) - hash);
            }
            const hue = Math.abs(hash) % 360;
            return `hsl(${hue} 60% 35%)`;
          };
          const bgColor = stringToColor(a.username || a.display_name || ('user' + a.id));

          return (
            <motion.div
              key={a.id}
              className="account-card"
              role="button"
              tabIndex={0}
              onClick={() => { setEditing(a); setFormOpen(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { setEditing(a); setFormOpen(true); } }}
                initial={{ opacity: 0, y: 8, scale: 0.995 }}
                animate={ highlightId === a.id ? { opacity: 1, y: 0, scale: [1, 1.03, 1] } : { opacity: 1, y: 0, scale: 1 } }
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                transition={ highlightId === a.id ? { type: 'tween', duration: 0.8, ease: 'easeInOut' } : { type: 'spring', stiffness: 300, damping: 24 } }
            >
              <div className="account-avatar" aria-hidden style={{ backgroundColor: bgColor }}>
                {a.avatar_url ? (
                  (function(){
                    const base = a.avatar_url.startsWith('http') ? a.avatar_url : `${getBackendOrigin()}${a.avatar_url}`;
                    const sep = base.includes('?') ? '&' : '?';
                    return <img src={`${base}${sep}v=${refreshTick}`} alt="avatar" />;
                  })()
                ) : a.avatar_data ? (
                  <img src={a.avatar_data} alt="avatar" />
                ) : (
                  <span className="avatar-initials">{initials}</span>
                )}
              </div>
              <div className="account-info">
                <div className="account-display" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>{a.display_name || a.username}</span>
                  {/* Online/Offline indicator */}
                  {a.is_online !== undefined && (
                    <span 
                      className={`status-indicator ${a.is_online ? 'online' : 'offline'}`}
                      title={a.is_online ? 'Online' : (a.last_seen ? `Last seen: ${fmtLastSeen(a.last_seen)}` : 'Offline')}
                    >
                      {a.is_online ? '🟢' : '⚫'}
                    </span>
                  )}
                </div>
                  <div className="account-role" style={{ textAlign: 'center' }}>{a.role === 'SERVER_ADMIN' ? 'SERVER ADMIN' : a.role}</div>
                  {/* Last seen pill under role - show only when offline */}
                  {!a.is_online && a.last_seen && (
                    <div
                      className="last-seen-pill"
                      title={a.last_seen ? new Date(a.last_seen).toLocaleString() : ''}
                    >
                      Last seen: {fmtLastSeen(a.last_seen)}
                    </div>
                  )}
                  {/* small badge in top-right of account card showing server-admin status/count */}
                  {a.role === 'SERVER_ADMIN' && (
                    <div className="server-admin-badge" title={serverAdminCounts[a.id] ? `${serverAdminCounts[a.id]} assigned server(s)` : 'Server admin'}>
                      <strong>SERVER ADMIN</strong>
                      {typeof serverAdminCounts[a.id] === 'number' && (
                        <span className="server-admin-count">{serverAdminCounts[a.id]}</span>
                      )}
                    </div>
                  )}
              </div>
              {/* Action buttons aligned at bottom-right */}
              { (user && (user.user?.role || user.role) === 'ADMIN') && (
                <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 10 }}>
                  <button
                    title={`Activity logs for ${a.display_name || a.username}`}
                    aria-label={`Activity logs for ${a.display_name || a.username}`}
                    onClick={(e) => { e.stopPropagation(); fetchActivityLogs(a); }}
                    style={{ 
                      width: '48px', 
                      height: '48px', 
                      borderRadius: '50%', 
                      border: 'none', 
                      backgroundColor: '#7c3aed', 
                      color: 'white',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      boxShadow: '0 2px 8px rgba(124, 58, 237, 0.3)',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(124, 58, 237, 0.3)';
                    }}
                  >
                    <FaHistory />
                  </button>
                  <button
                    title={`Info for ${a.display_name || a.username}`}
                    aria-label={`Info for ${a.display_name || a.username}`}
                    onClick={(e) => { e.stopPropagation(); openInfo(a); }}
                    style={{ 
                      width: '48px', 
                      height: '48px', 
                      borderRadius: '50%', 
                      border: 'none', 
                      backgroundColor: '#3b82f6', 
                      color: 'white',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
                    }}
                  >
                    <FaInfoCircle />
                  </button>
                  <button
                    title={`Delete ${a.display_name || a.username}`}
                    aria-label={`Delete ${a.display_name || a.username}`}
                    onClick={(e) => { e.stopPropagation(); handleDelete(a); }}
                    style={{ 
                      width: '48px', 
                      height: '48px', 
                      borderRadius: '50%', 
                      border: 'none', 
                      backgroundColor: '#ef4444', 
                      color: 'white',
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '1.1rem',
                      boxShadow: '0 2px 8px rgba(239, 68, 68, 0.3)',
                      transition: 'transform 0.2s, box-shadow 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.boxShadow = '0 2px 8px rgba(239, 68, 68, 0.3)';
                    }}
                  >
                    <FaTrashAlt />
                  </button>
                </div>
              ) }
            </motion.div>
          );
        })}
        </AnimatePresence>
      </div>

      {/* pagination controls */}
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
        <button className="icon-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Prev</button>
        <div>Page {page}</div>
        <button className="icon-btn" onClick={() => setPage(p => p + 1)} disabled={accountsList.length <= page * perPage}>Next</button>
      </div>

  <AdminEditorForm isOpen={formOpen} onClose={() => setFormOpen(false)} onSaved={reload} account={editing} servers={servers} />
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.display_name || deleteTarget.username}` : 'Delete'}
        className="confirm-modal"
        busy={deleting}
        actions={(
          <>
            <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="btn-danger" onClick={confirmDelete} aria-busy={deleting} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</button>
          </>
        )}
      >
        <div className="confirm-title">Are you sure?</div>
        <div className="confirm-body">This will permanently remove the account <strong>{deleteTarget ? (deleteTarget.display_name || deleteTarget.username) : ''}</strong> and cannot be undone.</div>
        {deleteError && <div className="error-toast" role="alert">{deleteError}</div>}
      </Modal>

      {/* Info modal showing recent login/IP/location */}
      <Modal
        isOpen={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={infoTarget ? `${infoTarget.display_name || infoTarget.username} — Recent activity` : 'Recent activity'}
        className="info-modal"
        compact
        busy={loadingAudit}
        actions={<button className="btn-secondary" onClick={() => setInfoOpen(false)}>Close</button>}
      >
        {auditErr && <div className="error-toast" role="alert">{auditErr}</div>}
        {loadingAudit && (
          <div className="modal-busy-overlay">
            <div className="spinner" />
            <div>Loading…</div>
          </div>
        )}
        {!loadingAudit && !auditErr && (
          <div className="audit-list">
            {auditRows.length === 0 ? (
              <div className="muted">No recent login activity.</div>
            ) : (
                  <>
                    <ul className="audit-ul">
                      {auditRows.slice((auditPage - 1) * auditPerPage, (auditPage - 1) * auditPerPage + auditPerPage).map(row => (
                        <li key={row.id} className="audit-li">
                          <div className="audit-line">
                            <span className="audit-time">{formatWithAppTZ(row.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                            <span className="audit-role">{row.role_at_login}</span>
                          </div>
                          <div className="audit-meta">
                            <span className="audit-ip">IP: {row.ip || '—'}</span>
                            <span className="audit-loc">Loc: {row.location || '—'}</span>
                          </div>
                          {row.user_agent && <div className="audit-ua" title={row.user_agent}>{row.user_agent}</div>}
                        </li>
                      ))}
                    </ul>
                    {auditRows.length > auditPerPage && (
                      <div className="modal-pagination" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', marginTop: '0.5rem' }}>
                        <button className="icon-btn" onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage === 1}>Prev</button>
                        <div>Page {auditPage} of {Math.ceil(auditRows.length / auditPerPage)}</div>
                        <button className="icon-btn" onClick={() => setAuditPage(p => Math.min(Math.ceil(auditRows.length / auditPerPage), p + 1))} disabled={auditPage >= Math.ceil(auditRows.length / auditPerPage)}>Next</button>
                      </div>
                    )}
                  </>
            )}
          </div>
        )}
      </Modal>

      {/* Activity Logs Modal */}
      <Modal
        isOpen={logsModal.open}
        onClose={() => setLogsModal({ open: false, account: null, logs: [], loading: false })}
        title={logsModal.account ? `Activity Logs - ${logsModal.account.display_name || logsModal.account.username}` : 'Activity Logs'}
        className="logs-modal"
      >
        {logsModal.loading && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div className="spinner" />
            <div>Loading logs...</div>
          </div>
        )}
        {!logsModal.loading && (
          <div className="logs-content">
            {logsModal.logs.length === 0 ? (
              <div className="muted" style={{ textAlign: 'center', padding: '1rem' }}>No activity logs found.</div>
            ) : (
              <div className="logs-table-wrapper">
                <table className="logs-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd' }}>
                      <th style={{ padding: '0.5rem', textAlign: 'left' }}>Date & Time</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left' }}>Action</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsModal.logs.map((log, idx) => {
                      const payload = log.payload || {};
                      const action = log.action || 'UNKNOWN';
                      let details = '';
                      if (payload.target_admin_id) details += `Target ID: ${payload.target_admin_id}`;
                      if (payload.username) details += ` User: ${payload.username}`;
                      if (payload.role) details += ` Role: ${payload.role}`;
                      
                      return (
                        <tr key={log.id || idx} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                            {formatWithAppTZ(log.created_at, { dateStyle: 'short', timeStyle: 'medium' })}
                          </td>
                          <td style={{ padding: '0.5rem', fontWeight: '500' }}>
                            {action}
                          </td>
                          <td style={{ padding: '0.5rem', fontSize: '0.9em', color: '#666' }}>
                            {details || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default AdminPanelPage;
 
