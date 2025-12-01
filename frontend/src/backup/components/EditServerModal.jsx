import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

function EditServerModal({ server, onClose, onSave }) {
  // State to hold the form data, initialized as empty
  const [formData, setFormData] = useState({
    server_name: '',
    owner: '',
    service_type: '',
    ip_address: '',
    domain_name: '',
  });

  // useEffect updates the form data whenever the 'server' prop changes
  useEffect(() => {
    if (server) {
      setFormData({
        server_name: server.server_name,
        owner: server.owner,
        service_type: server.service_type,
        ip_address: server.ip_address,
        domain_name: server.domain_name,
      });
    }
  }, [server]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({ ...prevState, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.put(`http://localhost:3001/api/servers/${server.id}`, formData);
      onSave(); // This will trigger a refresh and close the modal
    } catch (error) {
      console.error('Error updating server:', error);
    }
  };

  return (
    <AnimatePresence>
      {server && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="modal-content" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit}>
              <h3>Edit Server</h3>
              <input name="server_name" value={formData.server_name} onChange={handleChange} placeholder="Server Name" required />
              <input name="owner" value={formData.owner} onChange={handleChange} placeholder="Owner" />
              <input name="service_type" value={formData.service_type} onChange={handleChange} placeholder="Service Type" />
              <input name="ip_address" value={formData.ip_address} onChange={handleChange} placeholder="IP Address" />
              <input name="domain_name" value={formData.domain_name} onChange={handleChange} placeholder="Domain Name" />
              <div className="modal-actions">
                <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
                <button type="submit">Save Changes</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default EditServerModal;