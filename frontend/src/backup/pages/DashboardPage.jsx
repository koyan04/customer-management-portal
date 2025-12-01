import { useState, useEffect } from 'react';
import axios from 'axios';
import ServerList from './ServerList';
import AddServerForm from '../components/AddServerForm';

function DashboardPage() {
  const [servers, setServers] = useState([]);
  const [isFormVisible, setIsFormVisible] = useState(false);

  const fetchServers = async () => {
    try {
      const response = await axios.get('http://localhost:3001/api/servers');
      setServers(response.data);
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const handleServerAdded = () => {
    fetchServers();
    setIsFormVisible(false);
  };

  return (
    <>
      <div className="header">
        <h1>User Management Portal</h1>
        {!isFormVisible && (
          <button onClick={() => setIsFormVisible(true)} className="add-server-btn">
            + Add New Server
          </button>
        )}
      </div>
      {isFormVisible && (
        <AddServerForm onServerAdded={handleServerAdded} onCancel={() => setIsFormVisible(false)} />
      )}
      <ServerList servers={servers} fetchServers={fetchServers} />
    </>
  );
}

export default DashboardPage;