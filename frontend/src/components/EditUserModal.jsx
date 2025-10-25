import React, { useState, useEffect } from 'react';
import axios from 'axios';
import GlassSelect from './GlassSelect.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

function EditUserModal({ user, onClose, onSave }) {
  const { token: authToken } = useAuth();
  const initialFormState = {
    account_name: '',
    service_type: 'Mini',
    account_type: 'Basic',
    expire_date: '',
    total_devices: 1,
    data_limit_gb: 50,
    remark: '',
  };
  const [formData, setFormData] = useState(initialFormState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      // Normalize legacy service values to new set
      const normalizedService = (() => {
        const legacy = (user.service_type || '').toLowerCase();
        if (legacy === 'x-ray' || legacy === 'xray' || legacy === 'outline') return 'Mini';
        if (legacy === 'mini' || legacy === 'basic' || legacy === 'unlimited') return user.service_type;
        return 'Mini';
      })();
      setFormData(prev => ({
        ...prev,
        account_name: user.account_name ?? prev.account_name,
        service_type: normalizedService,
        account_type: user.account_type ?? prev.account_type,
        expire_date: user.expire_date ? new Date(user.expire_date).toISOString().split('T')[0] : prev.expire_date,
        total_devices: user.total_devices ?? prev.total_devices,
        data_limit_gb: (user.account_type === 'Unlimited') ? '' : (user.data_limit_gb !== null && user.data_limit_gb !== undefined ? user.data_limit_gb : (normalizedService === 'Mini' ? 50 : 100)),
        remark: user.remark ?? prev.remark,
      }));
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'service_type') {
      setFormData(prev => {
        if (value === 'Unlimited') {
          return { ...prev, service_type: value, account_type: 'Unlimited', data_limit_gb: '' };
        }
        const defaultLimit = value === 'Mini' ? 50 : 100;
        const nextLimit = (prev.account_type === 'Unlimited' || prev.data_limit_gb === '' || prev.data_limit_gb === null || prev.data_limit_gb === undefined)
          ? defaultLimit
          : prev.data_limit_gb;
        return { ...prev, service_type: value, account_type: 'Basic', data_limit_gb: nextLimit };
      });
    } else {
      setFormData(prev => ({ ...prev, [name]: e.target.value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      const dataToSubmit = { ...formData, data_limit_gb: formData.account_type === 'Unlimited' ? null : formData.data_limit_gb };
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      const token = authToken || localStorage.getItem('token');
  const res = await axios.put(`${backendOrigin}/api/users/${user.id}`, dataToSubmit, { headers: { Authorization: `Bearer ${token}` } });
  const updated = res && res.data ? res.data : null;
  onSave && onSave(updated);
      onClose && onClose();
    } catch (error) {
      console.error('Error updating user:', error);
      const status = error && error.response ? error.response.status : null;
      const msg = (error && error.response && (error.response.data && (error.response.data.msg || error.response.data.error))) || 'Failed to update user.';
      setError(status === 403 ? 'You do not have permission to update this user.' : msg);
    }
    finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        {/* Add 'edit-sized' so mobile rules apply (full-height, single scroll container) */}
        <motion.div className="modal-content compact-form edit-user-modal edit-sized" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
          <form onSubmit={handleSubmit} className="modal-form">
            <h3>Edit User: {user.account_name}</h3>
            
            {/* Row 1: Account Name | Expire Date */}
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="edit_account_name">Account Name</label>
                <input id="edit_account_name" name="account_name" value={formData.account_name} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="edit_expire_date">Expire Date</label>
                <input id="edit_expire_date" name="expire_date" value={formData.expire_date} onChange={handleChange} type="date" required />
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="edit_service_type">Service</label>
              <GlassSelect
                className="w-100"
                value={formData.service_type}
                onChange={(val) => handleChange({ target: { name: 'service_type', value: val } })}
                options={[
                  { value: 'Mini', label: 'Mini' },
                  { value: 'Basic', label: 'Basic' },
                  { value: 'Unlimited', label: 'Unlimited' },
                ]}
                ariaLabel="Service"
              />
            </div>
            
            {/* Row 3: Devices | Data Limit (hidden for Unlimited) */}
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="edit_total_devices">Devices</label>
                <input id="edit_total_devices" name="total_devices" value={formData.total_devices} onChange={handleChange} type="number" min="1" />
              </div>
              {formData.account_type !== 'Unlimited' && (
                <div className="form-group">
                  <label htmlFor="edit_data_limit_gb">Data Limit (GB)</label>
                  <input id="edit_data_limit_gb" name="data_limit_gb" value={formData.data_limit_gb} onChange={handleChange} type="number" min="0" />
                </div>
              )}
            </div>
            
             <div className="form-group">
              <label htmlFor="edit_remark">Remark (Optional)</label>
              <textarea id="edit_remark" name="remark" value={formData.remark} onChange={handleChange} rows="2"></textarea>
            </div>

            {/* Unlimited is now controlled via Service selection; checkbox removed */}

            <div className="modal-actions">
              {error && <div className="form-error" role="alert" style={{ color: '#ff9d9d', marginRight: 'auto' }}>{error}</div>}
              <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>Cancel</button>
              <button type="submit" className="submit-btn" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default EditUserModal;

