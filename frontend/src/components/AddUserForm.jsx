import React, { useState } from 'react';
import axios from 'axios';

function AddUserForm({ serverId, onUserAdded, onClose }) {
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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "unlimited") {
      setFormData(prevState => ({
        ...prevState,
        account_type: checked ? 'Unlimited' : 'Basic',
        data_limit_gb: checked ? '' : 100,
      }));
    } else {
      setFormData(prevState => ({ ...prevState, [name]: value }));
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
      <h4>Add New User</h4>
      
      <div className="form-group">
        <label htmlFor="account_name">Account Name</label>
        <input id="account_name" name="account_name" value={formData.account_name} onChange={handleChange} placeholder="e.g., john_doe" required />
      </div>

      <div className="form-group">
        <label htmlFor="expire_date">Expire Date</label>
        <input id="expire_date" name="expire_date" value={formData.expire_date} onChange={handleChange} type="date" required />
      </div>
      
      <div className="form-group">
        <label htmlFor="service_type">Service Type</label>
        <select id="service_type" name="service_type" value={formData.service_type} onChange={handleChange}>
          <option value="X-Ray">X-Ray</option>
          <option value="Outline">Outline</option>
        </select>
      </div>
      
      <div className="form-grid">
          <div className="form-group">
              <label htmlFor="total_devices">Devices</label>
              <input id="total_devices" name="total_devices" value={formData.total_devices} onChange={handleChange} type="number" min="1" />
          </div>
          {/* Data Limit input only shows for 'Basic' accounts */}
          {formData.account_type === 'Basic' && (
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
      
      <label className="checkbox-label">
            <input name="unlimited" type="checkbox" checked={formData.account_type === 'Unlimited'} onChange={handleChange} />
            {/* New structure for custom checkbox */}
            <span className="custom-checkbox">
                <span className="checkmark">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                </span>
            </span>
            <span>Unlimited Account</span>
      </label>

      <div className="form-buttons">
        <button type="button" className="btn-secondary" onClick={() => { (onClose || (() => {}))(); }}>Cancel</button>
        <button type="submit" className="submit-btn">+ Add User</button>
      </div>
    </form>
  );
}

export default AddUserForm;