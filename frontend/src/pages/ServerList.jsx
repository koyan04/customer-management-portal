import React, { useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { FaCog, FaTrashAlt, FaUser, FaCogs, FaNetworkWired, FaGlobe, FaRegCopy, FaCheck } from 'react-icons/fa';
// Corrected import paths below
import ConfirmModal from '../components/ConfirmModal.jsx';
import EditServerModal from '../components/EditServerModal.jsx';

function ServerList({ servers, fetchServers }) {
  const [serverToDelete, setServerToDelete] = useState(null);
  const [serverToEdit, setServerToEdit] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil((servers?.length || 0) / pageSize));
  const firstIndex = (page - 1) * pageSize;
  const visibleServers = Array.isArray(servers) ? servers.slice(firstIndex, firstIndex + pageSize) : [];
  const [copiedIp, setCopiedIp] = useState(null);
  // get current user role from local storage or AuthContext if available
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role || (localStorage.getItem('user') || null); } catch(e) { role = null; }

  const handleDelete = async (id) => {
    try {
      const token = localStorage.getItem('token');
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      await axios.delete(`${backendOrigin}/api/servers/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchServers();
    } catch (error) {
      console.error('Error deleting server:', error);
    }
    setServerToDelete(null);
  };
  
  const handleSave = () => {
    fetchServers();
    setServerToEdit(null);
  };

  const handleCopy = async (text) => {
    try {
      if (!text) return;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopiedIp(text);
      setTimeout(() => setCopiedIp(null), 1200);
    } catch (e) { /* ignore */ }
  };

  return (
    <div>
      {(!servers || servers.length === 0) && <p className="no-users-message">No servers found. Click "Add New Server" to begin.</p>}
      
      <ul className="server-list">
        <AnimatePresence>
          {visibleServers.map(server => (
            <motion.li
              key={server.id}
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -100, transition: { duration: 0.3 } }}
              className="server-list-item"
            >
              <div className="server-info">
                <Link to={`/servers/${server.id}`} className="server-name-link">
                  <div className="server-name">{server.server_name}</div>
                </Link>
                <div className="server-details">
                  <div className="server-meta">
                    <div className="server-meta-item"><span className="meta-icon"><FaUser /></span><strong>Owner</strong> {server.owner || '—'}</div>
                    <div className="server-meta-item"><span className="meta-icon"><FaCogs /></span><strong>Service</strong> {server.service_type || '—'}</div>
                    <div className="server-meta-item">
                      <span className="meta-icon"><FaNetworkWired /></span><strong>IP</strong> {server.ip_address || '—'}
                      {server.ip_address && (
                        <button type="button" className="copy-btn" title={copiedIp === server.ip_address ? 'Copied!' : 'Copy IP'} onClick={() => handleCopy(server.ip_address)}>
                          {copiedIp === server.ip_address ? <FaCheck /> : <FaRegCopy />}
                        </button>
                      )}
                    </div>
                    <div className="server-meta-item"><span className="meta-icon"><FaGlobe /></span><strong>Domain</strong> {server.domain_name || '—'}</div>
                  </div>
                </div>
              </div>
              <div className="server-actions">
                { (role === 'ADMIN') && (
                  <>
                    <button onClick={() => setServerToEdit(server)} className="icon-btn edit-btn">
                      <FaCog />
                    </button>
                    <button onClick={() => setServerToDelete(server)} className="icon-btn delete-btn">
                      <FaTrashAlt />
                    </button>
                  </>
                ) }
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {servers && servers.length > pageSize && (
        <div className="pagination">
          <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</button>
          {Array.from({ length: totalPages }).map((_, idx) => {
            const p = idx + 1;
            return (
              <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            );
          })}
          <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
        </div>
      )}

      <ConfirmModal
        isOpen={!!serverToDelete}
        onClose={() => setServerToDelete(null)}
        onConfirm={() => handleDelete(serverToDelete.id)}
        title="Confirm Deletion"
      >
        Are you sure you want to delete the server "{serverToDelete?.server_name}"?
      </ConfirmModal>

      <EditServerModal
        server={serverToEdit}
        onClose={() => setServerToEdit(null)}
        onSave={handleSave}
      />
    </div>
  );
}

export default ServerList;
