import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import AdminEditorForm from '../components/AdminEditorForm.jsx';
import { FaTrashAlt, FaUserPlus, FaTools, FaSearch } from 'react-icons/fa';
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

  const handleDelete = async (acct) => {
    // legacy fallback; prefer confirmation modal
    if (!acct) return;
    setDeleteTarget(acct);
  };

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

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
                <button
                  title={`Delete ${a.display_name || a.username}`}
                  aria-label={`Delete ${a.display_name || a.username}`}
                  className="icon-btn delete-icon"
                  onClick={(e) => { e.stopPropagation(); handleDelete(a); }}
                >
                  <FaTrashAlt />
                </button>
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
    </div>
  );
}

export default AdminPanelPage;


function InlineEditableAccount({ account, onSaved, token }) {
  const { user } = useAuth();
  const role = user?.user?.role || user?.role;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: account.display_name, role: account.role });

  useEffect(() => {
    setForm({ display_name: account.display_name, role: account.role });
  }, [account]);

  const saveInline = async () => {
    try {
      await axios.put(`/api/admin/accounts/${account.id}`, { display_name: form.display_name, role: form.role }, { headers: { Authorization: `Bearer ${token}` } });
      setEditing(false);
      onSaved();
    } catch (err) {
      console.error(err);
      alert('Failed to save');
    }
  };

  if (!editing) {
    return (
      <div style={{ fontWeight: 700 }} onDoubleClick={() => { if (role === 'ADMIN') setEditing(true); }}>
        {form.display_name} <small style={{ color: '#a0a0a0' }}>({form.role === 'SERVER_ADMIN' ? 'SERVER ADMIN' : form.role})</small>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
      <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
        <option value="VIEWER">VIEWER</option>
        <option value="ADMIN">ADMIN</option>
      </select>
      <button className="icon-btn" onClick={saveInline}>Save</button>
      <button className="icon-btn" onClick={() => { setEditing(false); setForm({ display_name: account.display_name, role: account.role }); }}>Cancel</button>
    </div>
  );
}
