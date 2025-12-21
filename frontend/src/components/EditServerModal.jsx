import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import { getBackendOrigin } from '../lib/backendOrigin';

function EditServerModal({ server, onClose, onSave }) {
  const { token: authToken } = useAuth();
  // State to hold the form data, initialized as empty
  const [formData, setFormData] = useState({
    server_name: '',
    owner: '',
    service_type: '',
    ip_address: '',
    domain_name: '',
    api_key: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // useEffect updates the form data whenever the 'server' prop changes
  useEffect(() => {
    if (server) {
      setFormData({
        server_name: server.server_name,
        owner: server.owner,
        service_type: server.service_type,
        ip_address: server.ip_address,
        domain_name: server.domain_name,
        api_key: server.api_key || '',
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
      setSaving(true);
      setError('');
      const backendOrigin = getBackendOrigin();
      const token = authToken || localStorage.getItem('token');
      await axios.put(`${backendOrigin}/api/servers/${server.id}`, formData, { headers: { Authorization: `Bearer ${token}` } });
      onSave && onSave(); // trigger refresh in parent
      onClose && onClose();
    } catch (error) {
      console.error('Error updating server:', error);
      const status = error && error.response ? error.response.status : null;
      const msg = (error && error.response && (error.response.data && (error.response.data.msg || error.response.data.error))) || 'Failed to update server.';
      setError(status === 403 ? 'You do not have permission to update this server.' : msg);
    }
    finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {server && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="modal-content" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSubmit} className="modal-form">
              <h3>Edit Server</h3>
              <input name="server_name" value={formData.server_name} onChange={handleChange} placeholder="Server Name" required />
              <input name="owner" value={formData.owner} onChange={handleChange} placeholder="Owner" />
              <input name="service_type" value={formData.service_type} onChange={handleChange} placeholder="Service Type" />
              <input name="ip_address" value={formData.ip_address} onChange={handleChange} placeholder="IP Address" />
              <input name="domain_name" value={formData.domain_name} onChange={handleChange} placeholder="Domain Name" />
              <div style={{ position: 'relative', width: '100%' }}>
                <input 
                  name="api_key" 
                  value={formData.api_key} 
                  onChange={handleChange} 
                  placeholder="API Key (Optional)" 
                  type={showApiKey ? 'text' : 'password'}
                  style={{ paddingRight: '2.5rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#888',
                    padding: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <FaEyeSlash size={16} /> : <FaEye size={16} />}
                </button>
              </div>
              {error && <div className="form-error" role="alert" style={{ color: '#ff9d9d' }}>{error}</div>}
              <div className="modal-actions">
                <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
                <button type="submit" className="submit-btn" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default EditServerModal;