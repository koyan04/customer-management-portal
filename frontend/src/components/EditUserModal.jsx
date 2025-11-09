import { useState, useEffect } from 'react';
import axios from 'axios';
import GlassSelect from './GlassSelect.jsx';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

function EditUserModal({ user, onClose, onSave }) {
  const { token: authToken } = useAuth();
  const initialFormState = {
    account_name: '',
    service_type: 'Mini',
    contact: '',
    expire_date: '',
    total_devices: 1,
    data_limit_gb: 100,
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
      // Helpers to keep date as date-only (YYYY-MM-DD) to avoid timezone shifts
      const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
      const toYMD = (val) => {
        if (!val) return '';
        const s = String(val);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d = new Date(s);
        if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        return '';
      };
      setFormData(prev => {
        const defaultDevices = normalizedService === 'Mini' ? 1 : 2;
        const defaultData = normalizedService === 'Unlimited' ? '' : 100;
        return ({
          ...prev,
          account_name: user.account_name ?? prev.account_name,
          service_type: normalizedService,
          // NOTE: service tiers moved from `account_type` to `service_type`.
          expire_date: user.expire_date ? toYMD(user.expire_date) : prev.expire_date,
          contact: user.contact ?? prev.contact,
          total_devices: (user.total_devices != null ? user.total_devices : defaultDevices),
          data_limit_gb: (normalizedService === 'Unlimited') ? '' : (user.data_limit_gb != null ? user.data_limit_gb : defaultData),
          remark: user.remark ?? prev.remark,
        });
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'service_type') {
      setFormData(prev => {
        if (value === 'Unlimited') {
          return { ...prev, service_type: value, total_devices: 2, data_limit_gb: '' };
        }
        const nextDevices = value === 'Mini' ? 1 : 2;
        const nextData = 100;
        return { ...prev, service_type: value, total_devices: nextDevices, data_limit_gb: nextData };
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
  const dataToSubmit = { ...formData, data_limit_gb: formData.service_type === 'Unlimited' ? null : formData.data_limit_gb };
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

            <div className="form-group">
              <label htmlFor="edit_contact">Contact</label>
              <input id="edit_contact" name="contact" value={formData.contact} onChange={handleChange} placeholder="Phone, Telegram, etc." />
            </div>
            
            {/* Row 3: Devices | Data Limit (hidden for Unlimited) */}
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="edit_total_devices">Devices</label>
                <input id="edit_total_devices" name="total_devices" value={formData.total_devices} onChange={handleChange} type="number" min="1" />
              </div>
              {formData.service_type !== 'Unlimited' && (
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

