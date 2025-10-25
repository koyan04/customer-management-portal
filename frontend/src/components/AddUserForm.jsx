import React, { useState } from 'react';
import axios from 'axios';
import GlassSelect from './GlassSelect.jsx';
import { FaUserPlus } from 'react-icons/fa';

function AddUserForm({ serverId, onUserAdded, onClose }) {
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

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'service_type') {
      setFormData(prev => {
        if (value === 'Unlimited') {
          return { ...prev, service_type: value, account_type: 'Unlimited', data_limit_gb: '' };
        }
        // Mini or Basic map to Basic account_type and default limits
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
      const dataToSubmit = {
        ...formData,
        server_id: serverId,
        data_limit_gb: formData.account_type === 'Unlimited' ? null : formData.data_limit_gb,
      };
  const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
  const token = localStorage.getItem('token');
  await axios.post(backendOrigin + '/api/users', dataToSubmit, { headers: { Authorization: `Bearer ${token}` } });
      onUserAdded();
      setFormData(initialFormState);
    } catch (error) {
      console.error('Error adding user:', error);
    }
  };

  return (
  <form onSubmit={handleSubmit} className="add-user-form compact-form">
    <h4 className="form-title"><FaUserPlus className="title-icon" aria-hidden /><span className="title-badge">Add New User</span></h4>
      
      <div className="form-group">
        <label htmlFor="account_name">Account Name</label>
        <input id="account_name" name="account_name" value={formData.account_name} onChange={handleChange} placeholder="e.g., john_doe" required />
      </div>

      <div className="form-group">
        <label htmlFor="expire_date">Expire Date</label>
        <input id="expire_date" name="expire_date" value={formData.expire_date} onChange={handleChange} type="date" required />
      </div>
      
      <div className="form-group">
        <label htmlFor="service_type">Service</label>
        <GlassSelect
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
      
    <div className="form-grid">
          <div className="form-group">
              <label htmlFor="total_devices">Devices</label>
              <input id="total_devices" name="total_devices" value={formData.total_devices} onChange={handleChange} type="number" min="1" />
          </div>
      {/* Data Limit input shows for Mini/Basic; hidden for Unlimited */}
      {formData.account_type !== 'Unlimited' && (
            <div className="form-group">
                <label htmlFor="data_limit_gb">Data Limit (GB)</label>
                <input id="data_limit_gb" name="data_limit_gb" value={formData.data_limit_gb} onChange={handleChange} type="number" min="0" />
            </div>
          )}
      </div>

      <div className="form-group">
        <label htmlFor="remark">Remark (Optional)</label>
        <textarea id="remark" name="remark" value={formData.remark} onChange={handleChange} rows="2" placeholder="Optional note about the account" />
      </div>
      
    {/* Unlimited is now selected via Service = Unlimited; checkbox removed */}

      <div className="form-buttons">
        <button type="button" className="btn-secondary" onClick={() => { (onClose || (() => {}))(); }}>Cancel</button>
        <button type="submit" className="submit-btn">+ Add User</button>
      </div>
    </form>
  );
}

export default AddUserForm;