import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { FaServer, FaUser, FaCheckCircle, FaExclamationTriangle, FaTimesCircle } from 'react-icons/fa';
import AddUserForm from '../components/AddUserForm.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';
import EditUserModal from '../components/EditUserModal.jsx';
import UserTable from '../components/UserTable.jsx';
import { motion } from 'framer-motion';

function ServerDetailPage() {
  const { id } = useParams();
  const [server, setServer] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [userToDelete, setUserToDelete] = useState(null);
  const [userToEdit, setUserToEdit] = useState(null);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' ? window.innerWidth >= 1000 : false);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1000);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const fetchPageData = async () => {
    try {
      setLoading(true);
      const [serverResponse, usersResponse] = await Promise.all([
        axios.get(`http://localhost:3001/api/servers/${id}`),
        axios.get(`http://localhost:3001/api/users/server/${id}`),
      ]);
      setServer(serverResponse.data);
      setUsers(usersResponse.data);
      setError('');
    } catch (err) {
      console.error("Error fetching data:", err);
      setError('Failed to load server data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPageData();
  }, [id]);
  
  const handleDelete = async () => {
    try {
      await axios.delete(`http://localhost:3001/api/users/${userToDelete.id}`);
      setUserToDelete(null);
      fetchPageData();
    } catch (err) {
      console.error('Error deleting user:', err);
    }
  };

  const handleSave = () => {
    setUserToEdit(null);
    fetchPageData();
  };

  const stats = useMemo(() => {
  const now = new Date();
  let active = 0, soon = 0, expired = 0;
  users.forEach(user => {
    const diff = new Date(user.expire_date) - now;
    if (diff < 0) {
      expired++;
    } else if (diff <= 24 * 60 * 60 * 1000) { // <= 24 hours
      soon++;
    } else {
      active++;
    }
  });
  return { total: users.length, active, soon, expired };
  }, [users]);

  if (loading) return <div className="app-container">Loading...</div>;
  if (error) return <div className="app-container">{error}</div>;

  return (
    <>
      <div className="header">
        <h1 className="server-title"><FaServer /> {server?.server_name}</h1>
        <Link to="/" className="back-link">&larr; Back to Dashboard</Link>
      </div>

      <div className={`top-area ${isFormVisible && isDesktop ? 'form-open' : ''}`}>
        <div className="stats-banner">
          <div className="stat-card"><FaUser /><div><span>Total Users</span><strong>{stats.total}</strong></div></div>
          <div className="stat-card"><FaCheckCircle className="icon-active"/><div><span>Active</span><strong>{stats.active}</strong></div></div>
          <div className="stat-card"><FaExclamationTriangle className="icon-soon"/><div><span>Expire Soon</span><strong>{stats.soon}</strong></div></div>
          <div className="stat-card"><FaTimesCircle className="icon-expired"/><div><span>Expired</span><strong>{stats.expired}</strong></div></div>
          {/* Place the section header under the stats column when on desktop and the add form is open */}
          {isDesktop && isFormVisible && (
            <motion.div className="user-list-header desktop-left" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}>
              <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
              {!isFormVisible && (
                <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                  + Add New User
                </button>
              )}
            </motion.div>
          )}
        </div>

        {/* If on desktop and form is open, show centered form (right column) and render the user list below spanning both columns */}
        {isDesktop && isFormVisible ? (
          <>
            <div className="form-center">
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                <AddUserForm serverId={id} onUserAdded={() => { fetchPageData(); setIsFormVisible(false); }} onClose={() => setIsFormVisible(false)} />
              </motion.div>
            </div>

            <div className="user-list-container">
              {/* Render header here only when not using the desktop-stats placement */}
              {!(isDesktop && isFormVisible) && (
                <motion.div className="user-list-header" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                  <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
                  {!isFormVisible && (
                    <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                      + Add New User
                    </button>
                  )}
                </motion.div>
              )}

              {users.length > 0 ? (
                <UserTable users={users} onEdit={setUserToEdit} onDelete={setUserToDelete} />
              ) : (
                <p className="no-users-message">No users found for this server. Click "Add New User" to begin.</p>
              )}
            </div>
          </>
        ) : (
          <div className="page-content">
            <div className="user-list-container">
              <motion.div className="user-list-header" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <h2><FaUser style={{ marginRight: '0.5rem' }} />User Accounts</h2>
                {!isFormVisible && (
                  <button onClick={() => setIsFormVisible(true)} className="add-user-btn">
                    + Add New User
                  </button>
                )}
              </motion.div>

              {/* Inline form for mobile / small screens */}
              {!isDesktop && isFormVisible && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <AddUserForm serverId={id} onUserAdded={() => { fetchPageData(); setIsFormVisible(false); }} onClose={() => setIsFormVisible(false)} />
                </motion.div>
              )}

              {users.length > 0 ? (
                <UserTable users={users} onEdit={setUserToEdit} onDelete={setUserToDelete} />
              ) : (
                <p className="no-users-message">No users found for this server. Click "Add New User" to begin.</p>
              )}
            </div>
          </div>
        )}
      </div>
      
      <ConfirmModal
        isOpen={!!userToDelete}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDelete}
        title="Confirm Deletion"
      >
        Are you sure you want to delete user "{userToDelete?.account_name}"? This action cannot be undone.
      </ConfirmModal>

      <EditUserModal
        user={userToEdit}
        onClose={() => setUserToEdit(null)}
        onSave={handleSave}
      />
    </>
  );
}

export default ServerDetailPage;