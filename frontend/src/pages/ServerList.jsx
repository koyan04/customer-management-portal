import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { FaCog, FaTrashAlt, FaUser, FaCogs, FaNetworkWired, FaGlobe, FaRegCopy, FaCheck, FaArrowsAlt, FaGripVertical, FaSave, FaTimes, FaExchangeAlt } from 'react-icons/fa';
import { getBackendOrigin } from '../lib/backendOrigin';
// Corrected import paths below
import ConfirmModal from '../components/ConfirmModal.jsx';
import EditServerModal from '../components/EditServerModal.jsx';
import UserTransferModal from '../components/UserTransferModal.jsx';

function ServerList({ servers, fetchServers }) {
  const [serverToDelete, setServerToDelete] = useState(null);
  const [serverToEdit, setServerToEdit] = useState(null);
  const [page, setPage] = useState(1);
  const [reorderMode, setReorderMode] = useState(false);
  const [localOrder, setLocalOrder] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);

  const handleOpenTransferModal = () => {
    setShowTransferModal(true);
    // Smooth scroll to transfer section after a short delay to allow modal to render
    setTimeout(() => {
      const transferSection = document.querySelector('.transfer-modal');
      if (transferSection) {
        transferSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };
  const pageSize = reorderMode ? 1000 : 10; // show all while reordering
  const totalPages = Math.max(1, Math.ceil((servers?.length || 0) / pageSize));
  const firstIndex = (page - 1) * pageSize;
  const sourceList = reorderMode ? (localOrder.length ? localOrder : servers) : servers;
  const visibleServers = Array.isArray(sourceList) ? sourceList.slice(firstIndex, firstIndex + pageSize) : [];
  const [copiedIp, setCopiedIp] = useState(null);
  const [userServerAdminFor, setUserServerAdminFor] = useState([]);
  const [currentRole, setCurrentRole] = useState(null);
  // get current user role from local storage or AuthContext if available
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role || (localStorage.getItem('user') || null); } catch(e) { role = null; }

  const fetchMyServerAdmins = useCallback(async () => {
    try {
      const backendOrigin = getBackendOrigin();
      const token = localStorage.getItem('token');
      const res = await axios.get(`${backendOrigin}/api/my-server-admins`, { headers: { Authorization: `Bearer ${token}` } });
      const list = res && res.data && Array.isArray(res.data.server_admin_for) ? res.data.server_admin_for : (res && res.data && res.data.server_admin_for ? res.data.server_admin_for : []);
      const r = res && res.data && res.data.role ? res.data.role : null;
      setUserServerAdminFor(Array.isArray(list) ? list.map((v) => Number(v)) : []);
      if (r) setCurrentRole(r);
    } catch (e) {
      setUserServerAdminFor([]);
      setCurrentRole(null);
    }
  }, []);

  useEffect(() => { fetchMyServerAdmins(); }, [fetchMyServerAdmins]);

  // Keep local order in sync when entering reorder mode or servers change
  useEffect(() => {
    if (!reorderMode) return;
    setLocalOrder(Array.isArray(servers) ? [...servers] : []);
    setPage(1);
  }, [reorderMode, servers]);

  const handleDelete = async (id) => {
    try {
      const token = localStorage.getItem('token');
      const backendOrigin = getBackendOrigin();
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

  // HTML5 drag-and-drop handlers (reorderMode only)
  const onDragStart = (e, id) => {
    if (!reorderMode) return;
    e.dataTransfer.setData('text/plain', String(id));
    // hint dragging effect
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e) => {
    if (!reorderMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e, targetId) => {
    if (!reorderMode) return;
    e.preventDefault();
    const draggedId = Number(e.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === targetId) return;
    setLocalOrder(prev => {
      const arr = Array.isArray(prev) && prev.length ? [...prev] : [];
      const fromIdx = arr.findIndex(s => Number(s.id) === draggedId);
      const toIdx = arr.findIndex(s => Number(s.id) === targetId);
      if (fromIdx === -1 || toIdx === -1) return arr;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  };

  const saveOrder = async () => {
    try {
      const token = localStorage.getItem('token');
      const backendOrigin = getBackendOrigin();
      const ids = (localOrder || []).map(s => s.id);
      await axios.put(`${backendOrigin}/api/servers/order`, { ids }, { headers: { Authorization: `Bearer ${token}` } });
      setReorderMode(false);
      await fetchServers();
    } catch (e) {
      console.error('Failed to save order:', e && (e.response ? (e.response.status + ' ' + (e.response.data && (e.response.data.msg || e.response.data.error) || '')) : (e.message || e)));
      if (e && e.response && e.response.status === 403) {
        alert('Not authorized: only admins can reorder servers.');
      } else if (e && e.response && e.response.data && (e.response.data.msg || e.response.data.error)) {
        alert('Failed to save order: ' + (e.response.data.msg || e.response.data.error));
      } else {
        alert('Failed to save order');
      }
    }
  };
  const cancelOrder = () => {
    setReorderMode(false);
    setLocalOrder([]);
  };

  return (
    <div>
      {reorderMode && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="reorder-banner"
        >
          <span className="banner-icon"><FaArrowsAlt /></span>
          <strong>Reorder mode</strong> — drag items to rearrange, then Save or Cancel.
        </motion.div>
      )}
      <div className="list-toolbar">
        <div className="flex-spacer" />
        <div className="actions">
          {((role === 'ADMIN') || (currentRole === 'ADMIN')) && (
            <>
              <button 
                className="page-btn" 
                onClick={handleOpenTransferModal}
                disabled={reorderMode}
                title="Transfer users between servers"
              >
                <FaExchangeAlt /> Transfer Users
              </button>
              <button className={`page-btn${reorderMode ? ' active' : ''}`} onClick={() => setReorderMode(m => !m)}>
                {reorderMode ? (<><FaTimes /> Exit Reorder</>) : (<><FaArrowsAlt /> Reorder</>)}
              </button>
            </>
          )}
          {reorderMode && (
            <>
              <button className="page-btn" onClick={saveOrder}><FaSave /> Save Order</button>
              <button className="page-btn" onClick={cancelOrder}><FaTimes /> Cancel</button>
            </>
          )}
        </div>
      </div>
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
              className={`server-list-item${reorderMode ? ' draggable' : ''}`}
              draggable={reorderMode}
              onDragStart={(e) => onDragStart(e, server.id)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, server.id)}
              whileHover={reorderMode ? { scale: 1.005 } : undefined}
            >
              {reorderMode && (
                <span className="drag-handle" title="Drag to reorder"><FaGripVertical /></span>
              )}
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
                { !reorderMode && ((role === 'ADMIN') || userServerAdminFor.includes(Number(server.id))) && (
                  <>
                    <button onClick={() => setServerToEdit(server)} className="icon-btn edit-btn" title="Edit server">
                      <FaCog />
                    </button>
                    { role === 'ADMIN' && (
                      <button onClick={() => setServerToDelete(server)} className="icon-btn delete-btn" title="Delete server">
                        <FaTrashAlt />
                      </button>
                    ) }
                  </>
                ) }
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {!reorderMode && servers && servers.length > pageSize && (
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

      <UserTransferModal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        servers={servers}
        onTransferComplete={fetchServers}
      />
    </div>
  );
}

export default ServerList;
