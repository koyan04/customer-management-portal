import { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import ServerList from './ServerList.jsx';
import AddServerForm from '../components/AddServerForm.jsx';

function DashboardPage() {
  const [servers, setServers] = useState([]);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const { token } = useAuth(); // Get the token from our context
  // derive role from localStorage as fallback
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role || (localStorage.getItem('user') || null); } catch(e) { role = null; }

  const fetchServers = async () => {
    if (!token) return; // Don't fetch if there's no token
    try {
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      const response = await axios.get(backendOrigin + '/api/servers', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setServers(response.data);
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  };

  useEffect(() => {
    fetchServers();
  }, [token]); // Re-fetch if the token changes

  const handleServerAdded = () => {
    fetchServers();
    setIsFormVisible(false);
  };

  return (
    <>
      {/* The main header is gone. This page now starts with the servers header. */}
      <div className="header">
        <h2>Servers</h2>
        {!isFormVisible && role === 'ADMIN' && (
          <button onClick={() => setIsFormVisible(true)} className="add-server-btn">
            + Add New Server
          </button>
        )}
      </div>
      {isFormVisible && (
        <AddServerForm onServerAdded={handleServerAdded} onCancel={() => setIsFormVisible(false)} />
      )}
      <ServerList servers={servers} fetchServers={handleServerAdded} />
    </>
  );
}

export default DashboardPage;

