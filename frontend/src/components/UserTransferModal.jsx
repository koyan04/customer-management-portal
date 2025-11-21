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

  // Filter users by search query
  const filteredUsers = users.filter(user => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      user.account_name?.toLowerCase().includes(q) ||
      user.contact?.toLowerCase().includes(q) ||
      user.service_type?.toLowerCase().includes(q)
    );
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

                {/* Search */}
                <div className="user-search" style={{ marginBottom: '1rem' }}>
                  <FaSearch className="search-icon" />
                  <input
                    type="text"
                    className="user-search-input"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    disabled={loading || transferring}
                  />
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
                    backgroundColor: 'rgba(79, 227, 131, 0.2)',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {filteredUsers.map(user => (
                      <label
                        key={user.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0.75rem',
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
                          style={{ marginRight: '0.75rem', width: '18px', height: '18px' }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600' }}>{user.account_name}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
                            {user.service_type} {user.contact ? `• ${user.contact}` : ''}
                          </div>
                        </div>
                        {selectedUserIds.has(user.id) && (
                          <FaCheck style={{ color: 'var(--accent)' }} />
                        )}
                      </label>
                    ))}
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
