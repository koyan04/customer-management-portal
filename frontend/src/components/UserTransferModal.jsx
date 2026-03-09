import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { FaTimes, FaExchangeAlt, FaSearch, FaCheck, FaServer, FaUser } from 'react-icons/fa';
import { getBackendOrigin } from '../lib/backendOrigin';

export default function UserTransferModal({ isOpen, onClose, servers, onTransferComplete }) {
  const [sourceServerId, setSourceServerId] = useState('');
  const [targetServerId, setTargetServerId] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterServiceType, setFilterServiceType] = useState(''); // '' = All
  const [filterStatus, setFilterStatus] = useState('');           // '' = All | 'enabled' | 'disabled'
  const [sortField, setSortField] = useState('account_name');     // 'account_name' | 'service_type' | 'status' | 'expire_date'
  const [sortDir, setSortDir] = useState('asc');                  // 'asc' | 'desc'
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSourceServerId('');
      setTargetServerId('');
      setUsers([]);
      setSelectedUserIds(new Set());
      setSearchQuery('');
      setFilterServiceType('');
      setFilterStatus('');
      setSortField('account_name');
      setSortDir('asc');
      setError('');
      setSuccess('');
    }
  }, [isOpen]);

  // Fetch users when source server is selected
  useEffect(() => {
    if (sourceServerId) {
      fetchUsers(sourceServerId);
    } else {
      setUsers([]);
      setSelectedUserIds(new Set());
      setFilterServiceType('');
      setFilterStatus('');
      setSearchQuery('');
      setSortField('account_name');
      setSortDir('asc');
    }
  }, [sourceServerId]);

  const fetchUsers = async (serverId) => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const backendOrigin = getBackendOrigin();
      const response = await axios.get(`${backendOrigin}/api/users/server/${serverId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Failed to load users from selected server');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserSelection = (userId) => {
    const newSet = new Set(selectedUserIds);
    if (newSet.has(userId)) {
      newSet.delete(userId);
    } else {
      newSet.add(userId);
    }
    setSelectedUserIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedUserIds.size === filteredUsers.length && filteredUsers.length > 0) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const handleTransfer = async () => {
    if (selectedUserIds.size === 0) {
      setError('Please select at least one user to transfer');
      return;
    }
    if (!targetServerId) {
      setError('Please select a target server');
      return;
    }
    if (sourceServerId === targetServerId) {
      setError('Source and target servers must be different');
      return;
    }

    setTransferring(true);
    setError('');
    setSuccess('');

    try {
      const token = localStorage.getItem('token');
      const backendOrigin = getBackendOrigin();
      const response = await axios.post(
        `${backendOrigin}/api/users/transfer`,
        {
          userIds: Array.from(selectedUserIds),
          targetServerId: Number(targetServerId)
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setSuccess(response.data.msg || `Successfully transferred ${response.data.transferred} user(s)`);
      setSelectedUserIds(new Set());
      
      // Refresh users list
      await fetchUsers(sourceServerId);
      
      // Notify parent to refresh
      if (onTransferComplete) {
        onTransferComplete();
      }

      // Auto-close after success
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Transfer error:', err);
      setError(err.response?.data?.msg || 'Failed to transfer users');
    } finally {
      setTransferring(false);
    }
  };

  // Mirror the same status logic used in UserTable across the app
  const parseDateOnly = (val) => {
    if (!val) return null;
    const s = String(val);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };
  const getUserStatusLabel = (user) => {
    if (user.enabled === false) return 'disabled';
    const now = new Date();
    const expiry = parseDateOnly(user.expire_date);
    if (!expiry) return 'active';
    const cutoff = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate() + 1);
    const msDiff = cutoff.getTime() - now.getTime();
    if (msDiff <= 0) return 'expired';
    if (msDiff <= 24 * 60 * 60 * 1000) return 'soon';
    return 'active';
  };

  // Toggle sort: same field flips direction; new field resets to asc
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, fontSize: '0.7rem' }}> ⇅</span>;
    return <span style={{ fontSize: '0.7rem' }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>;
  };

  // All known service types — always shown regardless of what the loaded server has
  const serviceTypes = ['Mini', 'Basic', 'Unlimited'];

  // Filter users by search + service type + status
  const filteredUsers = users.filter(user => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchesSearch = (
        user.account_name?.toLowerCase().includes(q) ||
        user.contact?.toLowerCase().includes(q) ||
        user.service_type?.toLowerCase().includes(q) ||
        user.remark?.toLowerCase().includes(q)
      );
      if (!matchesSearch) return false;
    }
    if (filterServiceType && (user.service_type || '').toLowerCase() !== filterServiceType.toLowerCase()) return false;
    if (filterStatus && getUserStatusLabel(user) !== filterStatus) return false;
    return true;
  });

  // Sort filteredUsers
  const statusOrder = { active: 0, soon: 1, expired: 2, disabled: 3 };
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'account_name') {
      cmp = (a.account_name || '').localeCompare(b.account_name || '');
    } else if (sortField === 'service_type') {
      cmp = (a.service_type || '').localeCompare(b.service_type || '');
    } else if (sortField === 'status') {
      cmp = (statusOrder[getUserStatusLabel(a)] ?? 9) - (statusOrder[getUserStatusLabel(b)] ?? 9);
    } else if (sortField === 'expire_date') {
      const da = a.expire_date ? new Date(a.expire_date).getTime() : Infinity;
      const db = b.expire_date ? new Date(b.expire_date).getTime() : Infinity;
      cmp = da - db;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const sourceServer = servers.find(s => s.id === Number(sourceServerId));
  const targetServer = servers.find(s => s.id === Number(targetServerId));

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          id="transfer-modal"
          className="modal-content transfer-modal"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3><FaExchangeAlt /> Transfer Users Between Servers</h3>
            <button className="modal-close" onClick={onClose} aria-label="Close">
              <FaTimes />
            </button>
          </div>

          <div className="modal-body">
            {/* Server Selection */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '1rem', marginBottom: '1.5rem', alignItems: 'center' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  <FaServer style={{ marginRight: '0.5rem' }} />
                  Source Server
                </label>
                <select
                  value={sourceServerId}
                  onChange={(e) => setSourceServerId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                  disabled={transferring}
                >
                  <option value="">Select source server</option>
                  {servers.map(server => (
                    <option key={server.id} value={server.id}>
                      {server.server_name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ paddingTop: '1.5rem' }}>
                <FaExchangeAlt size={24} style={{ color: 'var(--accent)' }} />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '600' }}>
                  <FaServer style={{ marginRight: '0.5rem' }} />
                  Target Server
                </label>
                <select
                  value={targetServerId}
                  onChange={(e) => setTargetServerId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                  disabled={transferring}
                >
                  <option value="">Select target server</option>
                  {servers
                    .filter(s => s.id !== Number(sourceServerId))
                    .map(server => (
                      <option key={server.id} value={server.id}>
                        {server.server_name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* User Selection */}
            {sourceServerId && (
              <div style={{ marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h4 style={{ margin: 0 }}>
                    <FaUser style={{ marginRight: '0.5rem' }} />
                    Select Users to Transfer
                  </h4>
                  {users.length > 0 && (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={toggleSelectAll}
                      disabled={loading || transferring}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.9rem' }}
                    >
                      {selectedUserIds.size === filteredUsers.length && filteredUsers.length > 0 ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                {/* Search + Filters */}
                <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <div className="user-search">
                    <FaSearch className="search-icon" />
                    <input
                      type="text"
                      className="user-search-input"
                      placeholder="Search by name, contact, service…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      disabled={loading || transferring}
                    />
                  </div>

                  {/* Filter pills — only show once users are loaded */}
                  {users.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
                      {/* Service type pills */}
                      {['', ...serviceTypes].map(svc => (
                        <button
                          key={svc || '__all_svc'}
                          type="button"
                          onClick={() => setFilterServiceType(svc)}
                          disabled={loading || transferring}
                          style={{
                            padding: '0.2rem 0.65rem',
                            borderRadius: '999px',
                            fontSize: '0.78rem',
                            fontWeight: '600',
                            border: '1px solid',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            borderColor: filterServiceType === svc ? 'var(--accent)' : 'rgba(255,255,255,0.2)',
                            backgroundColor: filterServiceType === svc ? 'var(--accent)' : 'transparent',
                            color: filterServiceType === svc ? '#000' : 'var(--muted-text)',
                          }}
                        >
                          {svc || 'All Types'}
                        </button>
                      ))}

                      {/* Divider */}
                      <span style={{ width: '1px', height: '16px', backgroundColor: 'rgba(255,255,255,0.15)', margin: '0 0.2rem' }} />

                      {/* Status pills */}
                      {[
                        ['', 'All Status'],
                        ['active', 'Active'],
                        ['soon', 'Expire Soon (≤24h)'],
                        ['expired', 'Expired'],
                        ['disabled', 'Disabled'],
                      ].map(([val, label]) => {
                        const isActive = filterStatus === val;
                        const dangerVals = ['expired', 'disabled'];
                        const warnVals = ['soon'];
                        const activeColor = dangerVals.includes(val) ? '#ff6b6b' : warnVals.includes(val) ? '#f0a500' : 'var(--accent)';
                        return (
                        <button
                          key={val || '__all_st'}
                          type="button"
                          onClick={() => setFilterStatus(val)}
                          disabled={loading || transferring}
                          style={{
                            padding: '0.2rem 0.65rem',
                            borderRadius: '999px',
                            fontSize: '0.78rem',
                            fontWeight: '600',
                            border: '1px solid',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                            borderColor: isActive ? activeColor : 'rgba(255,255,255,0.2)',
                            backgroundColor: isActive ? activeColor : 'transparent',
                            color: isActive ? '#000' : 'var(--muted-text)',
                          }}
                        >
                          {label}
                        </button>
                        );
                      })}

                      {/* Active filter count badge */}
                      {(filterServiceType || filterStatus || searchQuery) && (
                        <button
                          type="button"
                          onClick={() => { setFilterServiceType(''); setFilterStatus(''); setSearchQuery(''); }}
                          style={{
                            padding: '0.2rem 0.6rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            border: '1px solid rgba(255,100,100,0.4)',
                            backgroundColor: 'transparent',
                            color: '#ff6b6b',
                            cursor: 'pointer',
                            marginLeft: 'auto',
                          }}
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* User List */}
                {loading ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted-text)' }}>
                    Loading users...
                  </div>
                ) : users.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted-text)' }}>
                    No users found in this server
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted-text)' }}>
                    No users match your search
                  </div>
                ) : (
                  <div style={{ 
                    border: '1px solid rgba(255,255,255,0.1)', 
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}>
                    {/* Sticky sort header */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr 90px 100px 90px',
                      gap: '0.25rem',
                      padding: '0.4rem 0.75rem',
                      backgroundColor: 'rgba(0,0,0,0.35)',
                      borderBottom: '1px solid rgba(255,255,255,0.1)',
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                    }}>
                      <div />
                      {[['account_name','Name'],['service_type','Type'],['status','Status'],['expire_date','Expires']].map(([field, label]) => (
                        <button
                          key={field}
                          type="button"
                          onClick={() => handleSort(field)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            textAlign: 'left', padding: 0,
                            fontSize: '0.75rem', fontWeight: '700',
                            color: sortField === field ? 'var(--accent)' : 'var(--muted-text)',
                            letterSpacing: '0.04em', textTransform: 'uppercase',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {label}<SortIcon field={field} />
                        </button>
                      ))}
                    </div>
                    <div style={{ maxHeight: '280px', overflowY: 'auto', backgroundColor: 'rgba(79,227,131,0.08)' }}>
                    {sortedUsers.map(user => {const statusLabel = getUserStatusLabel(user); const statusColor = statusLabel === 'active' ? 'var(--accent)' : statusLabel === 'soon' ? '#f0a500' : '#ff6b6b'; return (
                      <label
                        key={user.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '24px 1fr 90px 100px 90px',
                          gap: '0.25rem',
                          alignItems: 'center',
                          padding: '0.6rem 0.75rem',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          transition: 'background-color 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(0,191,165,0.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserIds.has(user.id)}
                          onChange={() => toggleUserSelection(user.id)}
                          disabled={transferring}
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.account_name}</div>
                          {user.contact && <div style={{ fontSize: '0.78rem', color: 'var(--muted-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.contact}</div>}
                        </div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--muted-text)' }}>{user.service_type || '—'}</div>
                        <div style={{ fontSize: '0.78rem', fontWeight: '600', color: statusColor, textTransform: 'capitalize' }}>
                          {statusLabel === 'soon' ? 'Expire Soon' : statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--muted-text)' }}>
                          {user.expire_date ? user.expire_date.slice(0,10) : '—'}
                        </div>
                      </label>
                    );})}
                    </div>
                  </div>
                )}

                {selectedUserIds.size > 0 && (
                  <div style={{ 
                    marginTop: '1rem', 
                    padding: '0.75rem', 
                    backgroundColor: 'rgba(0,191,165,0.1)', 
                    borderRadius: '4px',
                    border: '1px solid rgba(0,191,165,0.3)'
                  }}>
                    <strong>{selectedUserIds.size}</strong> user(s) selected for transfer
                    {targetServer && (
                      <span> to <strong>{targetServer.server_name}</strong></span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Messages */}
            {error && (
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.75rem', 
                backgroundColor: 'rgba(255,0,0,0.1)', 
                border: '1px solid rgba(255,0,0,0.3)',
                borderRadius: '4px',
                color: '#ff6b6b'
              }}>
                {error}
              </div>
            )}

            {success && (
              <div style={{ 
                marginTop: '1rem', 
                padding: '0.75rem', 
                backgroundColor: 'rgba(0,191,165,0.1)', 
                border: '1px solid rgba(0,191,165,0.3)',
                borderRadius: '4px',
                color: 'var(--accent)'
              }}>
                {success}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn secondary"
              onClick={onClose}
              disabled={transferring}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={handleTransfer}
              disabled={transferring || selectedUserIds.size === 0 || !targetServerId || !sourceServerId}
            >
              {transferring ? 'Transferring...' : `Transfer ${selectedUserIds.size} User(s)`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
