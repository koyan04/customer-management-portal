import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import AdminEditorForm from '../components/AdminEditorForm.jsx';
import { FaTrashAlt, FaUserPlus, FaTools, FaSearch, FaInfoCircle } from 'react-icons/fa';
import Modal from '../components/Modal.jsx';
import { motion, AnimatePresence } from 'framer-motion';

function AdminPanelPage() {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [servers, setServers] = useState([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 8;

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await axios.get('/api/admin/accounts', { headers: { Authorization: `Bearer ${token}` } });
        const d = r.data;
        const normalized = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : (d && Array.isArray(d.accounts) ? d.accounts : []));
        setAccounts(normalized);
      } catch (err) {
        console.error(err);
      }

      // normalize servers response to always be an array
      try {
        const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
        const rs = await axios.get(backendOrigin + '/api/servers', { headers: { Authorization: `Bearer ${token}` } });
        const d2 = rs.data;
  const normalized2 = Array.isArray(d2) ? d2 : (d2 && Array.isArray(d2.data) ? d2.data : (d2 && Array.isArray(d2.servers) ? d2.servers : []));
        setServers(normalized2);
      } catch (err) {
        console.error('Failed to fetch servers with backend origin', err);
      }
    })();
  }, [token]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [highlightId, setHighlightId] = useState(null);

  const reload = (highlightForId = null) => {
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
  const accountsList = Array.isArray(accounts)
    ? accounts
    : (accounts && Array.isArray(accounts.data) ? accounts.data : (accounts && Array.isArray(accounts.accounts) ? accounts.accounts : []));

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
        const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
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
  }, [filteredAndPaged, token]);

  // Fetch last seen audit entry for visible accounts (one call per visible id, cached)
  useEffect(() => {
    (async () => {
      try {
        const ids = filteredAndPaged.filter(a => a && a.id).map(a => a.id).filter(id => typeof lastSeenMap[id] === 'undefined');
        if (!ids.length) return;
        const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
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
      const sameDay = d.toDateString() === now.toDateString();
      return sameDay ? ('Today ' + d.toLocaleTimeString()) : d.toLocaleString();
    } catch (_) { return null; }
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
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
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
      <div className="admin-header">
        <div className="admin-header-left">
          <FaTools className="admin-header-icon" aria-hidden="true" />
          <div>
            <h2 className="admin-title">Admin Panel</h2>
            <p className="admin-subtitle">Manage viewers and server permissions here.</p>
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
                    const base = a.avatar_url.startsWith('http') ? a.avatar_url : `${window.location.protocol}//${window.location.hostname}:${3001}${a.avatar_url}`;
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
                <div className="account-display">{a.display_name || a.username}</div>
                  <div className="account-role">{a.role === 'SERVER_ADMIN' ? 'SERVER ADMIN' : a.role}</div>
                  {/* Last seen pill under role (if we have recent audit) */}
                  {lastSeenMap[a.id] && lastSeenMap[a.id]?.ts && (
                    <div
                      className="last-seen-pill"
                      title={(lastSeenMap[a.id]?.ip ? `IP: ${lastSeenMap[a.id].ip}` : '') + (lastSeenMap[a.id]?.location ? `  Loc: ${lastSeenMap[a.id].location}` : '')}
                    >
                      Last seen: {fmtLastSeen(lastSeenMap[a.id].ts)}
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
              {/* Delete icon positioned at lower-right of the card */}
              { (user && (user.user?.role || user.role) === 'ADMIN') && (
                <>
                  <button
                    title={`Info for ${a.display_name || a.username}`}
                    aria-label={`Info for ${a.display_name || a.username}`}
                    className="icon-btn info-icon"
                    onClick={(e) => { e.stopPropagation(); openInfo(a); }}
                  >
                    <FaInfoCircle />
                  </button>
                  <button
                    title={`Delete ${a.display_name || a.username}`}
                    aria-label={`Delete ${a.display_name || a.username}`}
                    className="icon-btn delete-icon small"
                    onClick={(e) => { e.stopPropagation(); handleDelete(a); }}
                  >
                    <FaTrashAlt />
                  </button>
                </>
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
                            <span className="audit-time">{new Date(row.created_at).toLocaleString()}</span>
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
    </div>
  );
}

export default AdminPanelPage;
 
