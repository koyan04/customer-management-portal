import React, { useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal';
import EditServerModal from '../components/EditServerModal';

function ServerList({ servers, fetchServers }) {
  const [serverToDelete, setServerToDelete] = useState(null);
  const [serverToEdit, setServerToEdit] = useState(null);

  const handleDelete = async (id) => {
    try {
      await axios.delete(`http://localhost:3001/api/servers/${id}`);
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
      <h2>Server List</h2>
      {servers.length === 0 && <p>No servers found. Add one using the form above!</p>}
      
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
                <button onClick={() => setServerToEdit(server)} className="edit-btn">Edit</button>
                <button onClick={() => setServerToDelete(server)} className="delete-btn">Delete</button>
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
        Are you sure you want to delete the server "{serverToDelete?.server_name}"? This action cannot be undone.
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