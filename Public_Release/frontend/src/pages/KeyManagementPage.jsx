import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { FaCopy, FaPaste, FaKey, FaSearch, FaPlus, FaTimes, FaTrash, FaUser } from 'react-icons/fa';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import { getBackendOrigin } from '../lib/backendOrigin';

function KeyManagementInner() {
  const { id } = useParams(); // server id
  const { token: authToken } = useAuth();
  const [keys, setKeys] = useState([]);
  const [users, setUsers] = useState([]);
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());

  // modal state
  const [showBox, setShowBox] = useState(false);
  const [editing, setEditing] = useState(null); // key object when editing
  const [desc, setDesc] = useState('');
  const [origKey, setOrigKey] = useState('');
  const [genKey, setGenKey] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState(null);

  const backendOrigin = getBackendOrigin();

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const token = authToken || localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/servers/${id}/keys`, { headers: { Authorization: `Bearer ${token}` } });
      setKeys(Array.isArray(res.data) ? res.data : (res.data && res.data.data) ? res.data.data : []);
      setError('');
    } catch (e) {
      console.debug('Failed to fetch keys', e?.response?.status);
      setError('Could not load keys from server.');
      setKeys([]);
    } finally { setLoading(false); }
  }, [authToken, backendOrigin, id]);

  const fetchUsers = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/users/server/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(Array.isArray(res.data) ? res.data : (res.data && res.data.data) ? res.data.data : []);
    } catch (e) {
      console.debug('Failed to fetch users for server', e?.response?.status);
      setUsers([]);
    }
  }, [authToken, backendOrigin, id]);

  const fetchServer = useCallback(async () => {
    try {
      const token = authToken || localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/servers/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setServer(res.data || null);
    } catch (e) {
      console.debug('Failed to fetch server', e?.response?.status);
      setServer(null);
    }
  }, [authToken, backendOrigin, id]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchServer(); }, [fetchServer]);

  // role gating is handled by wrapper; inner always renders

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return keys;
    return keys.filter(k => ((k.username || '') + ' ' + (k.description || '')).toLowerCase().includes(q));
  }, [keys, search]);

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filtered.filter(k => k.id).map(k => k.id)));
  };

  const clearSelection = () => { setSelectedIds(new Set()); };

  const openBox = (keyObj) => {
    // If an existing key was provided, attempt to fetch full details (including original_key)
    (async () => {
      try {
        if (keyObj && keyObj.id) {
          const token = authToken || localStorage.getItem('token');
          const res = await axios.get(`${backendOrigin}/api/servers/${id}/keys/${keyObj.id}`, { headers: { Authorization: `Bearer ${token}` } });
          const full = res.data || {};
          setEditing(full);
          setDesc(full.description || '');
          setSelectedUser(full.username || '');
          setOrigKey(full.original_key || '');
          setGenKey(full.generated_key || '');
          setShowBox(true);
          return;
        }
      } catch (e) {
        console.debug('Failed to fetch key details for edit', e?.response?.status);
        // fall back to whatever was provided
      }
      setEditing(keyObj || null);
      setDesc(keyObj?.description || '');
      // prefer explicit username from key, fallback to empty
      setSelectedUser(keyObj?.username || '');
      setOrigKey(keyObj?.original_key || '');
      setGenKey(keyObj?.generated_key || '');
      setShowBox(true);
    })();
  };

  const closeBox = () => { setShowBox(false); setEditing(null); setDesc(''); setOrigKey(''); setGenKey(''); };

  const doGenerate = () => {
    // Replace IPv4 occurrences in original key with the server's domain name
    setGenerateAlertMessage('');
    setGenerateAlertOpen(false);
    if (!origKey || origKey.trim() === '') {
      setGenerateAlertMessage('No original key provided. Please paste or enter an original key before generating.');
      setGenerateAlertOpen(true);
      return;
    }
    // find IPv4 addresses
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const matches = origKey.match(ipRegex);
    if (!matches || !matches.length) {
      setGenerateAlertMessage('No IP address found in the original key. Unable to replace.');
      setGenerateAlertOpen(true);
      return;
    }
    const domain = (server && (server.domain_name || server.ip_address || server.server_name)) || '';
    if (!domain) {
      setGenerateAlertMessage('Server information not available to perform replacement.');
      setGenerateAlertOpen(true);
      return;
    }
    const replaced = origKey.replace(ipRegex, domain);
    // append suffix: #ServerName(UserName)
    const serverName = (server && (server.server_name || server.domain_name || server.ip_address)) || '';
    const userName = selectedUser || (editing && editing.username) || '';
    const suffix = `#${serverName}(${userName})`;
    setGenKey(replaced + suffix);
  };

  const [generateAlertOpen, setGenerateAlertOpen] = useState(false);
  const [generateAlertMessage, setGenerateAlertMessage] = useState('');

  const doPasteOrig = async () => {
    try { const txt = await navigator.clipboard.readText(); setOrigKey(txt || ''); } catch (e) { console.debug('clipboard read failed', e); }
  };

  const doCopyGenerated = async () => {
    try {
      await navigator.clipboard.writeText(genKey || '');
      // show a confirmation toast when copy succeeds
      showToast({ variant: 'success', title: 'Copied', message: 'Generated key copied to clipboard' });
    } catch (e) {
      console.debug('clipboard write failed', e);
      showToast({ variant: 'error', title: 'Copy failed', message: 'Could not copy key to clipboard' });
    }
  };

  const doSave = async () => {
    try {
      const token = authToken || localStorage.getItem('token');
      const payload = {
        username: selectedUser || undefined,
        description: desc,
        original_key: origKey || undefined,
        generated_key: genKey || undefined,
      };
      if (editing && editing.id) {
        await axios.put(`${backendOrigin}/api/servers/${id}/keys/${editing.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      } else {
        await axios.post(`${backendOrigin}/api/servers/${id}/keys`, payload, { headers: { Authorization: `Bearer ${token}` } });
      }
      closeBox();
      fetchKeys();
    } catch (e) {
      console.error('Save failed', e);
      setError('Save failed');
    }
  };

  const { show: showToast } = useToast();

  const doCopy = async (keyString) => {
    try { await navigator.clipboard.writeText(keyString || ''); return true; } catch (e) { console.debug('copy failed', e); return false; }
  };

  

  return (
    <div className="app-container key-management-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2><FaKey style={{ marginRight: '0.5rem' }} />Key Management</h2>
          <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
            <Link to={`/servers/${id}`} className="btn">Back to server</Link>
            <button className="btn" onClick={() => openBox(null)}><FaPlus /> Add Key</button>
            {/* Delete: operate on selected checkboxes (no popup) */}
            <button
              className="btn btn-danger"
              onClick={() => {
                if (!selectedIds || selectedIds.size === 0) {
                  showToast({ variant: 'error', title: 'No selection', message: 'No keys selected to delete' });
                  return;
                }
                setKeyToDelete({ ids: Array.from(selectedIds) });
                setDeleteConfirmOpen(true);
              }}
            ><FaTrash /> Delete</button>
          </div>
      </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <div className="user-search">
          <FaSearch className="search-icon" aria-hidden />
          <input className="user-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search username or description..." />
        </div>
      </div>

      {error && <div className="settings-status" role="status">{error}</div>}
      <div className="table-scroll">
        {/* Page-scoped CSS to enforce desktop column ratios and ensure any leftover popover styles are hidden */}
        <style>{`
          /* Desktop ratios */
          @media (min-width: 769px) {
            .key-management-page .user-table { table-layout: fixed; width: 100%; min-width: 0; }
            .key-management-page .user-table th:nth-child(1),
            .key-management-page .user-table td:nth-child(1) { width: 2%; }
            .key-management-page .user-table th:nth-child(2),
            .key-management-page .user-table td:nth-child(2) { width: 35%; }
            .key-management-page .user-table th:nth-child(3),
            .key-management-page .user-table td:nth-child(3) { width: 35%; }
            .key-management-page .user-table th:nth-child(4),
            .key-management-page .user-table td:nth-child(4) { width: 28%; }
            /* defensive: hide any leftover delete popover styles */
            .delete-menu-popover { display: none !important; }
          }

          /* Mobile ratios (requested): 4%, 27%, 25%, 44% */
          @media (max-width: 520px) {
            .key-management-page .user-table { table-layout: fixed; width: 100%; min-width: 0; }
            .key-management-page .user-table th:nth-child(1),
            .key-management-page .user-table td:nth-child(1) { width: 4%; }
            .key-management-page .user-table th:nth-child(2),
            .key-management-page .user-table td:nth-child(2) { width: 27%; }
            .key-management-page .user-table th:nth-child(3),
            .key-management-page .user-table td:nth-child(3) { width: 25%; }
            .key-management-page .user-table th:nth-child(4),
            .key-management-page .user-table td:nth-child(4) { width: 44%; }
          }
        `}</style>
        <table className="user-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Select all" checked={filtered.length > 0 && Array.from(selectedIds).length === filtered.filter(k => k.id).length} onChange={(e) => { if (e.target.checked) selectAllVisible(); else clearSelection(); }} />
              </th>
              <th><span className="thead-icon"><FaUser /></span>Username</th>
              <th>Key Description</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(k => (
              <tr key={k.id || (k.username + (k.description||''))}>
                <td>
                  <input type="checkbox" checked={selectedIds.has(k.id)} onChange={() => toggleSelect(k.id)} aria-label={`Select key ${k.id || k.username}`} />
                </td>
                <td>{k.username || k.user || '-'}</td>
                <td>{k.description || '-'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button className="btn" title="Show key" onClick={() => openBox(k)}><FaKey /></button>
                    {(k.generated_key || k.original_key) ? (
                      <>
                        <button className="btn" title="Copy key" onClick={async () => { await doCopy(k.generated_key || k.original_key); showToast({ variant: 'success', title: 'Copied', message: 'Key copied to clipboard' }); }}><FaCopy /></button>
                        <button className="btn btn-danger" title="Delete key" onClick={() => { setKeyToDelete(k); setDeleteConfirmOpen(true); }}><FaTrash /></button>
                      </>
                    ) : (
                      <>
                        <button className="btn" title="No key available" disabled><FaCopy /></button>
                        <button className="btn btn-danger" title="Delete key" onClick={() => { setKeyToDelete(k); setDeleteConfirmOpen(true); }}><FaTrash /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '1rem', textAlign: 'center' }}>{loading ? 'Loading...' : 'No keys found'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Key box modal (simple) */}
      {showBox && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" style={{ zIndex: 1200 }}>
          <div className="modal-content" style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>{editing ? `Key for ${editing.username || ''}` : 'New Key'}</h3>
              <button className="modal-close" onClick={closeBox}><FaTimes /></button>
            </div>
            <div className="modal-form" style={{ display: 'grid', gap: '0.75rem' }}>
              <label>
                <span>Username</span>
                <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)} style={{ padding: '8px', borderRadius: 6 }}>
                  <option value="">(choose user)</option>
                  {users.map(u => (
                    <option key={u.id} value={u.username || u.account_name || u.display_name || u.id}>{u.username || u.account_name || u.display_name || u.id}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Key Description</span>
                <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </label>
              <label>
                <span>Original key</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="text" value={origKey} onChange={(e) => setOrigKey(e.target.value)} style={{ flex: 1 }} />
                  <button title="Paste from clipboard" className="btn" onClick={doPasteOrig}><FaPaste /></button>
                </div>
              </label>
              <label>
                <span>Generated key</span>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="text" value={genKey} onChange={(e) => setGenKey(e.target.value)} style={{ flex: 1 }} />
                  <button title="Copy generated" className="btn" onClick={doCopyGenerated}><FaCopy /></button>
                </div>
              </label>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button className="btn" onClick={doGenerate}>Generate</button>
                <button className="btn" onClick={doSave}>Save</button>
                <button className="btn" onClick={closeBox}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={generateAlertOpen}
        onClose={() => setGenerateAlertOpen(false)}
        onConfirm={() => setGenerateAlertOpen(false)}
        title="Cannot generate key"
        confirmLabel="OK"
      >
        {generateAlertMessage}
      </ConfirmModal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => { setDeleteConfirmOpen(false); setKeyToDelete(null); }}
        onConfirm={async () => {
          try {
            const token = authToken || localStorage.getItem('token');
            if (keyToDelete && Array.isArray(keyToDelete.ids)) {
              // bulk delete: iterate sequentially
              const ids = keyToDelete.ids.filter(Boolean);
              const failed = [];
              for (const kid of ids) {
                try {
                  await axios.delete(`${backendOrigin}/api/servers/${id}/keys/${kid}`, { headers: { Authorization: `Bearer ${token}` } });
                } catch (err) {
                  console.error('Failed to delete key', kid, err);
                  failed.push(kid);
                }
              }
              setDeleteConfirmOpen(false);
              setKeyToDelete(null);
              clearSelection();
              fetchKeys();
              if (failed.length === 0) {
                showToast({ variant: 'success', title: 'Deleted', message: `${ids.length} key(s) deleted` });
              } else {
                showToast({ variant: 'error', title: 'Partial failure', message: `${ids.length - failed.length} deleted, ${failed.length} failed` });
              }
              return;
            }

            // single delete fallback
            const token2 = authToken || localStorage.getItem('token');
            await axios.delete(`${backendOrigin}/api/servers/${id}/keys/${keyToDelete.id}`, { headers: { Authorization: `Bearer ${token2}` } });
            setDeleteConfirmOpen(false);
            setKeyToDelete(null);
            fetchKeys();
            showToast({ variant: 'success', title: 'Deleted', message: 'Key deleted' });
          } catch (e) {
            console.error('Delete failed', e);
            showToast({ variant: 'error', title: 'Delete failed', message: e?.response?.data?.msg || e?.message || 'Delete failed' });
          }
        }}
        title="Delete Key"
        confirmLabel="Yes, delete"
        confirmClassName="btn-danger"
      >
        {keyToDelete && Array.isArray(keyToDelete.ids) ? (
          <span>Are you sure you want to delete {keyToDelete.ids.length} key(s)? This action cannot be undone.</span>
        ) : (
          <span>Are you sure you want to delete this key for "{keyToDelete?.username || keyToDelete?.description || ''}"?</span>
        )}
      </ConfirmModal>

    </div>
  );
}

export default function KeyManagementPage() {
  const { user } = useAuth();
  const role = user && (user.user?.role || user.role);
  if (role && role !== 'ADMIN' && role !== 'SERVER_ADMIN') {
    return (
      <div className="app-container">
        <div className="forbidden-panel">
          <div className="forbidden-icon" aria-hidden>🔒</div>
          <div>
            <h3 className="forbidden-title">Access denied</h3>
            <p className="forbidden-desc">You don't have permission to manage keys for this server.</p>
            <p className="forbidden-help">If you need access, ask a global administrator to grant you server-admin rights.</p>
            <div className="forbidden-cta">
              <a className="btn btn-secondary" href="/server-list">View Server List</a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return <KeyManagementInner />;
}
