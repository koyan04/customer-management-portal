import React, { useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { FaCog, FaTrashAlt } from 'react-icons/fa'; // Correct icon names
// Corrected import paths below
import ConfirmModal from '../components/ConfirmModal.jsx';
import EditServerModal from '../components/EditServerModal.jsx';

function ServerList({ servers, fetchServers }) {
  const [serverToDelete, setServerToDelete] = useState(null);
  const [serverToEdit, setServerToEdit] = useState(null);
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

  return (
    <div>
      {servers.length === 0 && <p className="no-users-message">No servers found. Click "Add New Server" to begin.</p>}
      
      <ul className="server-list">
        <AnimatePresence>
          {servers.map(server => (
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
                  Owner: {server.owner} | Service: {server.service_type}
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
