import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FaServer, FaUser, FaCheckCircle, FaExclamationTriangle, FaTimesCircle, FaChevronLeft, FaUserPlus, FaSearch, FaFileImport, FaFileExport, FaKey } from 'react-icons/fa';
import GlassSelect from '../components/GlassSelect.jsx';
import AddUserForm from '../components/AddUserForm.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import ImportModeModal from '../components/ImportModeModal.jsx';
import EditUserModal from '../components/EditUserModal.jsx';
import UserTable from '../components/UserTable.jsx';
import { motion } from 'framer-motion';
import { getBackendOrigin } from '../lib/backendOrigin';
import { useToast } from '../context/ToastContext.jsx';

function ServerDetailPage() {
  const { id } = useParams();
  const [server, setServer] = useState(null);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | soon | expired
  const [serviceFilter, setServiceFilter] = useState('all'); // all | Mini | Basic | Unlimited
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [userServerAdminFor, setUserServerAdminFor] = useState([]);
  
  const [userToDelete, setUserToDelete] = useState(null);
  const [userToEdit, setUserToEdit] = useState(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [importModeOpen, setImportModeOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  // pendingMode removed (unused)
  const { show: showToast } = useToast();
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1000 : false);
  // prefer AuthContext for token/user info
  const { token: authToken, user: authUser } = useAuth();
  const role = authUser?.user?.role || authUser?.role || null;

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1000);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const fetchPageData = useCallback(async () => {
    try {
      setLoading(true);
  const backendOrigin = getBackendOrigin();
  const token = authToken || localStorage.getItem('token');
      const [serverResponse, usersResponse] = await Promise.all([
        axios.get(`${backendOrigin}/api/servers/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${backendOrigin}/api/users/server/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setServer(serverResponse.data);
  // assign a stable display position for each user so quick updates don't reorder rows
  const usersWithPos = (usersResponse.data || []).map((u, i) => ({
    ...u,
    // prefer server-provided display_pos; coerce to number. fall back to existing __pos or index
    display_pos: Number.isFinite(Number(u.display_pos)) ? Number(u.display_pos) : (typeof u.__pos === 'number' ? u.__pos : i)
  }));
  setUsers(usersWithPos);
      // fetch server-admin assignments for current user
      try {
        const myAdminRes = await axios.get(`${backendOrigin}/api/my-server-admins`, { headers: { Authorization: `Bearer ${token}` } });
        const list = myAdminRes && myAdminRes.data ? (Array.isArray(myAdminRes.data.server_admin_for) ? myAdminRes.data.server_admin_for : (myAdminRes.data.server_admin_for || [])) : [];
        setUserServerAdminFor(list);
      } catch (e) { 
        console.debug('Failed to fetch my-server-admins', e && e.response ? e.response.status : e);
        setUserServerAdminFor([]); 
      }
      setError('');
    } catch (err) {
      console.error("Error fetching data:", err);
      setError('Failed to load server data.');
    } finally {
      setLoading(false);
    }
  }, [authToken, id]);

  useEffect(() => { fetchPageData(); }, [fetchPageData]);

  const filteredUsers = useMemo(() => {
  // preserve stable display order by sorting on display_pos (persisted server-side)
  const ordered = (users || []).slice().sort((a, b) => (typeof a.display_pos === 'number' ? a.display_pos : 0) - (typeof b.display_pos === 'number' ? b.display_pos : 0));
    const q = (searchQuery || '').toLowerCase().trim();
    const now = new Date();
    const parseDateOnly = (val) => {
      if (!val) return null;
      const s = String(val);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const normalizeService = (s) => {
      const v = (s || '').toLowerCase();
      if (v === 'x-ray' || v === 'xray' || v === 'outline') return 'Mini';
      if (v === 'mini') return 'Mini';
      if (v === 'basic') return 'Basic';
      if (v === 'unlimited') return 'Unlimited';
      return s || '';
    };
    return ordered.filter(u => {
      // text
      const name = (u.account_name || '').toLowerCase();
      const remark = (u.remark || '').toLowerCase();
      if (q && !(name.includes(q) || remark.includes(q))) return false;
      // status
      if (statusFilter !== 'all') {
        const exp = parseDateOnly(u.expire_date);
        const cutoff = exp ? new Date(exp.getFullYear(), exp.getMonth(), exp.getDate() + 1) : null; // exclusive end-of-day
        const diff = (cutoff ? cutoff.getTime() : NaN) - now.getTime();
        const status = diff <= 0 ? 'expired' : (diff <= 24 * 60 * 60 * 1000 ? 'soon' : 'active');
        if (status !== statusFilter) return false;
      }
      // service
      if (serviceFilter !== 'all') {
        const svc = normalizeService(u.service_type);
        if (svc !== serviceFilter) return false;
      }
      return true;
    });
  }, [users, searchQuery, statusFilter, serviceFilter]);

  // Import/Export handlers
  const doExport = async () => {
    try {
      const backendOrigin = getBackendOrigin();
      const token = authToken || localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/users/server/${id}/export.xlsx`, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
  // Export omits id and server_id; the system manages those
  a.download = `server-${id}-users.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error('Export failed', e);
      showToast({ variant: 'error', title: 'Export failed', message: e?.response?.data?.msg || e?.message || 'Export failed' });
    }
  };

  const doTemplate = async () => {
    try {
      const backendOrigin = getBackendOrigin();
      const token = authToken || localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/users/server/${id}/template.xlsx`, { headers: { Authorization: `Bearer ${token}` }, responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
  // Template omits id and server_id; only user-editable fields
  a.download = `server-${id}-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error('Template download failed', e);
      showToast({ variant: 'error', title: 'Template download failed', message: e?.response?.data?.msg || e?.message || 'Template download failed' });
    }
  };

  const fileInputRef = React.useRef(null);
  const doImportClick = () => fileInputRef.current && fileInputRef.current.click();
  const onImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setPendingImportFile(f);
    setImportModeOpen(true);
  };

  const runImportWithMode = async (mode) => {
    try {
      if (!pendingImportFile) return;
      const backendOrigin = getBackendOrigin();
      const token = authToken || localStorage.getItem('token');
      const form = new FormData();
      form.append('file', pendingImportFile);
      const res = await axios.post(`${backendOrigin}/api/users/server/${id}/import.xlsx?mode=${encodeURIComponent(mode)}`, form, { headers: { Authorization: `Bearer ${token}`, 'X-Import-Mode': mode } });
      const r = res.data && res.data.results;
      showToast({
        variant: 'success',
        title: 'Import completed',
        message: `Mode: ${mode}. Inserted: ${r?.inserted || 0}, Updated: ${r?.updated || 0}${r?.errors?.length ? `, Errors: ${r.errors.length}` : ''}`
      });
  setImportModeOpen(false);
  setOverwriteConfirmOpen(false);
  setPendingImportFile(null);
      fetchPageData();
    } catch (e2) {
  console.error('Import failed', e2);
  const msg = (e2?.response?.data?.msg || e2?.message || 'Import failed');
  showToast({ variant: 'error', title: 'Import failed', message: msg });
  setImportModeOpen(false);
  setOverwriteConfirmOpen(false);
  setPendingImportFile(null);
    }
  };

  const handleImportModeSelect = (mode) => {
    if (mode === 'overwrite') {
      setImportModeOpen(false);
      setOverwriteConfirmOpen(true);
    } else {
      runImportWithMode('merge');
    }
  };
  
  const handleDelete = async () => {
    try {
      const backendOrigin = getBackendOrigin();
      const token = localStorage.getItem('token');
      await axios.delete(`${backendOrigin}/api/users/${userToDelete.id}`, { headers: { Authorization: `Bearer ${token}` } });
      setUserToDelete(null);
      fetchPageData();
    } catch (err) {
      console.error('Error deleting user:', err);
    }
  };

  const handleSave = (updatedUser) => {
    setUserToEdit(null);
    if (updatedUser && updatedUser.id) {
      setUsers(prev => prev.map(u => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u)));
    } else {
      // Fallback: if updated data not provided, refetch as before
      fetchPageData();
    }
  };

  // Quick renew: add months to user's expire_date
  const handleQuickRenew = async (user, months) => {
    try {
      const backendOrigin = getBackendOrigin();
      const token = authToken || localStorage.getItem('token');
      // compute new expire_date on client without timezone drift: if expired, start from today; else from current date-only
      const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
      const parseDateOnly = (val) => {
        if (!val) return null;
        const s = String(val);
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); // local Y-M-D
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
      };
      const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const today = new Date();
      const current = user.expire_date ? parseDateOnly(user.expire_date) : null;
      const base = (!current || current < today) ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : current;
      const next = new Date(base.getFullYear(), base.getMonth() + months, base.getDate());
      // include display_pos so server can preserve ordering on update
      const payload = { ...user, expire_date: toYMD(next), display_pos: (typeof user.display_pos === 'number' ? user.display_pos : (typeof user.__pos === 'number' ? user.__pos : undefined)) };
      const res = await axios.put(`${backendOrigin}/api/users/${user.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
      const updated = res.data;
      setUsers(prev => {
        const idx = prev.findIndex(u => u.id === updated.id);
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = { ...next[idx], ...updated };
        return next;
      });
      showToast({ variant: 'success', title: 'Renewed', message: `Added ${months} month(s) to ${user.account_name}` });
    } catch (e) {
      console.error('Quick renew failed', e);
      showToast({ variant: 'error', title: 'Renew failed', message: e?.response?.data?.msg || e?.message || 'Renew failed' });
    }
  };

  const stats = useMemo(() => {
    const now = new Date();
    let active = 0, soon = 0, expired = 0;
    const parseDateOnly = (val) => {
      if (!val) return null;
      const s = String(val);
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    users.forEach(user => {
      const exp = parseDateOnly(user.expire_date);
      const cutoff = exp ? new Date(exp.getFullYear(), exp.getMonth(), exp.getDate() + 1) : null;
      const diff = (cutoff ? cutoff.getTime() : NaN) - now.getTime();
      if (diff <= 0) expired++;
      else if (diff <= 24 * 60 * 60 * 1000) soon++;
      else active++;
    });
    return { total: users.length, active, soon, expired };
  }, [users]);

  if (loading) return <div className="app-container">Loading...</div>;
  if (error) return <div className="app-container">{error}</div>;

  return (
    <>
      {/* Back button above the header, plus Key Management link on the same row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', padding: '6px 0 0 0', gap: '8px' }}>
        <Link to="/server-list" className="back-link">
          <FaChevronLeft className="back-icon" aria-hidden /> <span>Back to Server List</span>
        </Link>
        {(role === 'ADMIN' || userServerAdminFor.includes(Number(id))) && (
          <Link to={`/servers/${id}/keys`} className="back-link" title="Key Management">
            <FaKey className="back-icon" aria-hidden /> <span>Key Management</span>
          </Link>
        )}
      </div>
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', width: '100%' }}>
          {/* Left side: title only */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 className="server-title"><FaServer /> {server?.server_name}</h1>
          </div>
          {/* Right side: IO actions pinned to right margin */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Right-aligned IO actions */}
            <button type="button" className="btn io-btn" onClick={doExport} title="Export .xlsx">
              <FaFileExport className="btn-icon" aria-hidden />
              <span>Export</span>
            </button>
            {/* Keys link moved to the top back-link row and now uses the same back-link styling */}
            {(role === 'ADMIN' || userServerAdminFor.includes(Number(id))) && (
              <>
                <input type="file" accept=".xlsx" ref={fileInputRef} onChange={onImportFile} style={{ display: 'none' }} />
                <button type="button" className="btn io-btn" onClick={doImportClick} title="Import (.xlsx)">
                  <FaFileImport className="btn-icon" aria-hidden />
                  <span>Import</span>
                </button>
                <button type="button" className="btn io-btn" onClick={doTemplate} title="Download Template (.xlsx)">
                  <FaFileExport className="btn-icon" aria-hidden />
                  <span>Template</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`top-area ${isFormVisible && isDesktop ? 'form-open' : ''}`}>
        <div className="stats-banner">
          <div className="stat-card"><FaUser /><div><span>Total Users</span><strong>{stats.total}</strong></div></div>
          <div className="stat-card"><FaCheckCircle className="icon-active"/><div><span>Active</span><strong>{stats.active}</strong></div></div>
          <div className="stat-card"><FaExclamationTriangle className="icon-soon"/><div><span>Expire Soon</span><strong>{stats.soon}</strong></div></div>
          <div className="stat-card"><FaTimesCircle className="icon-expired"/><div><span>Expired</span><strong>{stats.expired}</strong></div></div>
          {/* Place the section header under the stats column when on desktop and the add form is open */}
              {isDesktop && isFormVisible && (
            <motion.div className="user-list-header desktop-left" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
              <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
              <div className="user-header-actions">
                <div className="user-search">
                  <FaSearch className="search-icon" aria-hidden />
                  <input
                    type="text"
                    className="user-search-input"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search users"
                  />
                </div>
                <div className="user-filters">
                  <GlassSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      { value: 'all', label: 'All Status' },
                      { value: 'active', label: 'Active' },
                      { value: 'soon', label: 'Expire Soon (≤24h)' },
                      { value: 'expired', label: 'Expired' },
                    ]}
                    ariaLabel="Filter by status"
                  />
                  <GlassSelect
                    value={serviceFilter}
                    onChange={setServiceFilter}
                    options={[
                      { value: 'all', label: 'All Services' },
                      { value: 'Mini', label: 'Mini' },
                      { value: 'Basic', label: 'Basic' },
                      { value: 'Unlimited', label: 'Unlimited' },
                    ]}
                    ariaLabel="Filter by service"
                  />
                </div>
                {(role === 'ADMIN' || userServerAdminFor.includes(Number(id))) && !isFormVisible && (
                  <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                    <FaUserPlus className="btn-icon" aria-hidden size={14} />
                    <span>Add New User</span>
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </div>

        {/* If on desktop and form is open, show centered form (right column) and render the user list below spanning both columns */}
        {isDesktop && isFormVisible ? (
          <>
            <div className="form-center">
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                <AddUserForm serverId={id} onUserAdded={() => { fetchPageData(); setIsFormVisible(false); }} onClose={() => setIsFormVisible(false)} />
              </motion.div>
            </div>

            <div className="user-list-container">
              {/* Render header here only when not using the desktop-stats placement */}
              {!(isDesktop && isFormVisible) && (
                <motion.div className="user-list-header" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                  <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
                  <div className="user-header-actions">
                    <div className="user-search">
                      <FaSearch className="search-icon" aria-hidden />
                      <input
                        type="text"
                        className="user-search-input"
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Search users"
                      />
                    </div>
                    <div className="user-filters">
                      <GlassSelect
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                          { value: 'all', label: 'All Status' },
                          { value: 'active', label: 'Active' },
                          { value: 'soon', label: 'Expire Soon (≤24h)' },
                          { value: 'expired', label: 'Expired' },
                        ]}
                        ariaLabel="Filter by status"
                      />
                      <GlassSelect
                        value={serviceFilter}
                        onChange={setServiceFilter}
                        options={[
                          { value: 'all', label: 'All Services' },
                          { value: 'Mini', label: 'Mini' },
                          { value: 'Basic', label: 'Basic' },
                          { value: 'Unlimited', label: 'Unlimited' },
                        ]}
                        ariaLabel="Filter by service"
                      />
                    </div>
                    {(role === 'ADMIN' || userServerAdminFor.includes(Number(id))) && !isFormVisible && (
                      <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                        <FaUserPlus className="btn-icon" aria-hidden size={14} />
                        <span>Add New User</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              )}

              {filteredUsers.length > 0 ? (
                <UserTable users={filteredUsers} onEdit={setUserToEdit} onDelete={setUserToDelete} onQuickRenew={handleQuickRenew} canManageUsers={(role === 'ADMIN') || (userServerAdminFor.includes(Number(id)))} showContact={isDesktop} />
              ) : (
                <p className="no-users-message">No users found for this server. { (role === 'ADMIN' || userServerAdminFor.includes(Number(id))) ? 'Click "Add New User" to begin.' : '' }</p>
              )}
            </div>
          </>
        ) : (
          <div className="page-content">
            <div className="user-list-container">
              <motion.div className="user-list-header" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
                <div className="user-header-actions">
                  <div className="user-search">
                    <FaSearch className="search-icon" aria-hidden />
                    <input
                      type="text"
                      className="user-search-input"
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search users"
                    />
                  </div>
                  <div className="user-filters">
                    <GlassSelect
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={[
                        { value: 'all', label: 'All Status' },
                        { value: 'active', label: 'Active' },
                        { value: 'soon', label: 'Expire Soon (≤24h)' },
                        { value: 'expired', label: 'Expired' },
                      ]}
                      ariaLabel="Filter by status"
                    />
                    <GlassSelect
                      value={serviceFilter}
                      onChange={setServiceFilter}
                      options={[
                        { value: 'all', label: 'All Services' },
                        { value: 'Mini', label: 'Mini' },
                        { value: 'Basic', label: 'Basic' },
                        { value: 'Unlimited', label: 'Unlimited' },
                      ]}
                      ariaLabel="Filter by service"
                    />
                  </div>
                  {(role === 'ADMIN' || userServerAdminFor.includes(Number(id))) && !isFormVisible && (
                    <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                      <FaUserPlus className="btn-icon" aria-hidden size={14} />
                      <span>Add New User</span>
                    </button>
                  )}
                </div>
              </motion.div>

              {/* Inline form for mobile / small screens */}
              {!isDesktop && isFormVisible && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <AddUserForm serverId={id} onUserAdded={() => { fetchPageData(); setIsFormVisible(false); }} onClose={() => setIsFormVisible(false)} />
                </motion.div>
              )}

              {filteredUsers.length > 0 ? (
                <UserTable users={filteredUsers} onEdit={setUserToEdit} onDelete={setUserToDelete} onQuickRenew={handleQuickRenew} canManageUsers={(role === 'ADMIN') || (userServerAdminFor.includes(Number(id)))} showContact={isDesktop} />
              ) : (
                <p className="no-users-message">No users found for this server. { (role === 'ADMIN' || userServerAdminFor.includes(Number(id))) ? 'Click "Add New User" to begin.' : '' }</p>
              )}
            </div>
          </div>
        )}
      </div>
      
      <ConfirmModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDelete}
        title="Confirm Deletion"
      >
        Are you sure you want to delete user "{userToDelete?.account_name}"? This action cannot be undone.
      </ConfirmModal>

      <EditUserModal
        user={userToEdit}
        onClose={() => setUserToEdit(null)}
        onSave={handleSave}
      />

      {/* Import mode prompt */}
      <ImportModeModal
        isOpen={importModeOpen}
        onClose={() => { setImportModeOpen(false); setPendingImportFile(null); }}
        onSelect={handleImportModeSelect}
      />

      {/* Overwrite confirmation warning */}
      <ConfirmModal
        isOpen={overwriteConfirmOpen}
        onClose={() => { setOverwriteConfirmOpen(false); }}
        onConfirm={() => runImportWithMode('overwrite')}
        title="Overwrite all users?"
        confirmLabel="Yes, overwrite"
        confirmClassName="btn-danger"
      >
        This will erase all existing users for this server and replace them with the imported file. This action cannot be undone.
      </ConfirmModal>

      {/* Global Toast handled by ToastProvider at app root */}
    </>
  );
}

export default ServerDetailPage;