import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

export default function ChangePassword() {
  const { token } = useAuth();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setMessage('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('New password and confirmation do not match');
      return;
    }
    try {
      const res = await axios.post('/api/admin/change-password', { oldPassword, newPassword }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage(res.data.msg || 'Password updated');
    } catch (err) {
      setMessage(err.response?.data?.msg || 'Error');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="change-password-form">
      <h3>Change Password</h3>
      <div className="form-group">
        <label htmlFor="old-password">Old Password</label>
        <input id="old-password" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="new-password">New Password</label>
        <input id="new-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
      </div>
      <div className="form-group">
        <label htmlFor="confirm-password">Confirm New Password</label>
        <input id="confirm-password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
      </div>
      <button type="submit" className="submit-btn">Change Password</button>
      {message && <p className="helper">{message}</p>}
    </form>
  );
}
