import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

function EditUserModal({ user, onClose, onSave }) {
  const initialFormState = {
    account_name: '',
    service_type: 'X-Ray',
    account_type: 'Basic',
    expire_date: '',
    total_devices: 1,
    data_limit_gb: 100,
    remark: '',
  };
  const [formData, setFormData] = useState(initialFormState);

  useEffect(() => {
    if (user) {
      setFormData(prev => ({
        ...prev,
        account_name: user.account_name ?? prev.account_name,
        service_type: user.service_type ?? prev.service_type,
        account_type: user.account_type ?? prev.account_type,
        expire_date: user.expire_date ? new Date(user.expire_date).toISOString().split('T')[0] : prev.expire_date,
        total_devices: user.total_devices ?? prev.total_devices,
        data_limit_gb: user.data_limit_gb !== null && user.data_limit_gb !== undefined ? user.data_limit_gb : prev.data_limit_gb,
        remark: user.remark ?? prev.remark,
      }));
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "unlimited") {
      setFormData(prevState => ({
        ...prevState,
        account_type: checked ? 'Unlimited' : 'Basic',
        data_limit_gb: checked ? '' : (prevState.data_limit_gb || 100),
      }));
    } else {
      setFormData(prevState => ({ ...prevState, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const dataToSubmit = { ...formData, data_limit_gb: formData.account_type === 'Unlimited' ? null : formData.data_limit_gb };
      await axios.put(`http://localhost:3001/api/users/${user.id}`, dataToSubmit);
      onSave();
    } catch (error) {
      console.error('Error updating user:', error);
    }
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
        <motion.div className="modal-content compact-form" initial={{ y: -50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
          <form onSubmit={handleSubmit} className="modal-form">
            <h3>Edit User: {user.account_name}</h3>
            
            <div className="form-group">
              <label htmlFor="edit_account_name">Account Name</label>
              <input id="edit_account_name" name="account_name" value={formData.account_name} onChange={handleChange} required />
            </div>
            
            <div className="form-group">
              <label htmlFor="edit_expire_date">Expire Date</label>
              <input id="edit_expire_date" name="expire_date" value={formData.expire_date} onChange={handleChange} type="date" required />
            </div>
            
            <div className="form-group">
              <label htmlFor="edit_service_type">Service Type</label>
              <select id="edit_service_type" name="service_type" value={formData.service_type} onChange={handleChange}>
                <option value="X-Ray">X-Ray</option>
                <option value="Outline">Outline</option>
              </select>
            </div>
            
            {/* REMOVED the form-grid and stacked the inputs */}
            <div className="form-group">
              <label htmlFor="edit_total_devices">Devices</label>
              <input id="edit_total_devices" name="total_devices" value={formData.total_devices} onChange={handleChange} type="number" min="1" />
            </div>
            {formData.account_type === 'Basic' && (
              <div className="form-group">
                <label htmlFor="edit_data_limit_gb">Data Limit (GB)</label>
                <input id="edit_data_limit_gb" name="data_limit_gb" value={formData.data_limit_gb} onChange={handleChange} type="number" min="0" />
              </div>
            )}
            
             <div className="form-group">
              <label htmlFor="edit_remark">Remark (Optional)</label>
              <textarea id="edit_remark" name="remark" value={formData.remark} onChange={handleChange} rows="2"></textarea>
            </div>

            <label className="checkbox-label">
              <input name="unlimited" type="checkbox" checked={formData.account_type === 'Unlimited'} onChange={handleChange} />
              <span className="custom-checkbox"><span className="checkmark"></span></span>
              <span>Unlimited Account</span>
            </label>

            <div className="modal-actions">
              <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
              <button type="submit" className="submit-btn">Save Changes</button>
            </div>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default EditUserModal;

