import React from 'react';
import { FaCog, FaTrashAlt } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';

const getUserStatus = (expireDate) => {
  const now = new Date();
  const expiry = new Date(expireDate);
  const msDiff = expiry - now;
  const hoursDiff = msDiff / (1000 * 60 * 60);
  if (hoursDiff < 0) return { text: 'Expired', className: 'status-expired' };
  // Expire Soon is now defined as <= 24 hours
  if (hoursDiff <= 24) return { text: 'Expire Soon', className: 'status-soon' };
  return { text: 'Active', className: 'status-active' };
};

const formatDuration = (expireDate) => {
    const now = new Date();
    const expiry = new Date(expireDate);
    let diff = expiry - now;
    if (diff < 0) return '0d 0h';
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    diff -= days * (1000 * 60 * 60 * 24);
    const hours = Math.floor(diff / (1000 * 60 * 60));
    return `${days}d ${hours}h`;
};

function UserTable({ users, onEdit, onDelete, canManageUsers = null }) {
  // determine role from localStorage as a fallback to AuthContext
  let role = null;
  try { role = JSON.parse(localStorage.getItem('user'))?.role || (localStorage.getItem('user') || null); } catch(e) { role = null; }
  const allowActions = canManageUsers !== null ? canManageUsers : (role === 'ADMIN');

  return (
    <div className="user-table-container">
      <table className="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Service</th>
            <th>Duration</th>
            <th>Expire Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {users.map(user => {
              const status = getUserStatus(user.expire_date);
              return (
                <motion.tr 
                    key={user.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -50 }}
                    transition={{ duration: 0.3 }}
                >
                  <td data-label="Name">
                    <div className="user-name-cell">
                      {user.account_name}
                      {user.remark && <span className="user-remark">{user.remark}</span>}
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className={`status-indicator ${status.className}`}></span>
                    {status.text}
                  </td>
                  <td data-label="Service">{user.service_type}</td>
                  <td data-label="Duration">{formatDuration(user.expire_date)}</td>
                  <td data-label="Expire Date">
                    {/* THIS LINE FIXES THE DATE FORMAT */}
                    {new Date(user.expire_date).toLocaleDateString('en-GB')}
                  </td>
                  <td data-label="Actions">
                    <div className="user-actions">
                      { allowActions ? (
                        <>
                          <button onClick={() => onEdit(user)} className="icon-btn edit-btn"><FaCog /></button>
                          <button onClick={() => onDelete(user)} className="icon-btn delete-btn"><FaTrashAlt /></button>
                        </>
                      ) : (
                        <span style={{ color: '#888' }}>No actions</span>
                      ) }
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}

export default UserTable;

