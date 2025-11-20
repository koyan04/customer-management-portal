import React, { useState } from 'react';
import axios from 'axios';

// The component now accepts an 'onCancel' prop
function AddServerForm({ onServerAdded, onCancel }) {
  const [formData, setFormData] = useState({
    server_name: '',
    owner: '',
    service_type: '',
    ip_address: '',
    domain_name: '',
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('http://localhost:3001/api/servers', formData);
      onServerAdded(); // This now calls handleServerAdded in App.jsx
    } catch (error) {
      console.error('Error adding server:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="add-server-form">
      <h3>Add a New Server</h3>
      <input name="server_name" value={formData.server_name} onChange={handleChange} placeholder="Server Name" required />
      <input name="owner" value={formData.owner} onChange={handleChange} placeholder="Owner" />
      <input name="service_type" value={formData.service_type} onChange={handleChange} placeholder="Service Type (e.g., Outline)" />
      <input name="ip_address" value={formData.ip_address} onChange={handleChange} placeholder="IP Address" />
      <input name="domain_name" value={formData.domain_name} onChange={handleChange} placeholder="Domain Name" />
      
      {/* Container for the buttons */}
      <div className="form-buttons">
        <button type="button" onClick={onCancel} className="cancel-btn">Cancel</button>
        <button type="submit">Add Server</button>
      </div>
    </form>
  );
}

export default AddServerForm;