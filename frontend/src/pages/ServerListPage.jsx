// React not needed
import ServerList from './ServerList.jsx';
import AddServerForm from '../components/AddServerForm.jsx';
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FaPlus, FaServer } from 'react-icons/fa';

export default function ServerListPage() {
  const [servers, setServers] = useState([]);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const { token, user } = useAuth();
  const role = user?.user?.role || user?.role;

  const fetchServers = useCallback(async () => {
    if (!token) return;
    try {
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      const response = await axios.get(backendOrigin + '/api/servers', { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
      if (response.status === 401 || response.status === 403) {
        return; // token invalid/expired; AuthProvider will redirect
      }
      setServers(Array.isArray(response.data) ? response.data : (response.data && response.data.data) || []);
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  }, [token]);

  useEffect(() => { fetchServers(); }, [fetchServers]);

  const handleServerAdded = () => {
    fetchServers();
    setIsFormVisible(false);
  };

  return (
    <div>
      <div className="header">
        <h2><span className="title-icon" aria-hidden="true"><FaServer /></span>Server List</h2>
        {!isFormVisible && role === 'ADMIN' && (
          <button onClick={() => setIsFormVisible(true)} className="add-server-btn">
            <span className="btn-icon" aria-hidden="true"><FaPlus /></span>
            <span className="btn-label">Add New Server</span>
          </button>
        )}
      </div>

      {isFormVisible && (
        <AddServerForm onServerAdded={handleServerAdded} onCancel={() => setIsFormVisible(false)} />
      )}

      <ServerList servers={servers} fetchServers={handleServerAdded} />
    </div>
  );
}
