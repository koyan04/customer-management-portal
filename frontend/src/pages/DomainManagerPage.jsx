import React, { useState, useEffect } from 'react';
import { FaGlobe, FaPlus, FaTrash, FaEdit, FaSave, FaTimes } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { getBackendOrigin } from '../lib/backendOrigin';
import './DomainManagerPage.css';

const DomainManagerPage = () => {
  const { token } = useAuth();
  const [domains, setDomains] = useState([]);
  const [domainInput, setDomainInput] = useState('');
  const [serverRegion, setServerRegion] = useState('SG');
  const [service, setService] = useState('Basic');
  const [unlimited, setUnlimited] = useState(false);
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingData, setEditingData] = useState({});
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const SortTh = ({ field, children, className }) => (
    <th className={className} onClick={() => handleSort(field)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {children}
      <span style={{ marginLeft: '4px', fontSize: '0.7em', opacity: sortField === field ? 1 : 0.3 }}>
        {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '⇅'}
      </span>
    </th>
  );
  const sortedDomains = sortField ? [...domains].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'service') cmp = (a.service || '').localeCompare(b.service || '');
    else if (sortField === 'server') cmp = (a.server || '').localeCompare(b.server || '');
    else if (sortField === 'domain') cmp = (a.domain || '').localeCompare(b.domain || '');
    return sortDir === 'asc' ? cmp : -cmp;
  }) : domains;

  // Available server regions
  const regions = ['SG', 'HK', 'US', 'JP', 'ID', 'TH', 'VN', 'UK', 'CN', 'IN', 'AU'];

  // Fetch domains from backend
  const fetchDomains = async () => {
    try {
      const backendOrigin = getBackendOrigin();
      const response = await axios.get(`${backendOrigin}/api/domains`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDomains(response.data);
    } catch (error) {
      console.error('Error fetching domains:', error);
      setDomains([]);
    }
  };

  useEffect(() => {
    fetchDomains();
  }, [token]);

  // Save domains to localStorage (temporary until backend is ready)
  const saveDomains = (updatedDomains) => {
    localStorage.setItem('domains', JSON.stringify(updatedDomains));
    setDomains(updatedDomains);
  };

  // Auto-increment server number based on existing servers
  const getNextServerNumber = (region, service, unlimited) => {
    // Filter by region AND service combination (allow same server name if service differs)
    const serviceKey = unlimited ? `${service} Unlimited` : service;
    const existingServers = domains
      .filter(d => {
        const dServiceKey = d.unlimited ? `${d.service} Unlimited` : d.service;
        return d.server.startsWith(region) && dServiceKey === serviceKey;
      })
      .map(d => {
        const match = d.server.match(/\d+/);
        return match ? parseInt(match[0]) : 0;
      });
    
    const maxNumber = existingServers.length > 0 ? Math.max(...existingServers) : 0;
    const nextNumber = maxNumber + 1;
    return `${region}${String(nextNumber).padStart(2, '0')}`;
  };

  // Add domain
  const handleAddDomain = async () => {
    if (!domainInput.trim()) {
      alert('Please enter a domain name');
      return;
    }

    const serverName = getNextServerNumber(serverRegion, service, unlimited);
    
    try {
      const backendOrigin = getBackendOrigin();
      await axios.post(
        `${backendOrigin}/api/domains`,
        {
          domain: domainInput.trim(),
          server: serverName,
          service: service,
          unlimited: unlimited
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // Refresh domains list
      await fetchDomains();
      
      // Reset form
      setDomainInput('');
      setUnlimited(false);
    } catch (error) {
      console.error('Error adding domain:', error);
      alert('Failed to add domain');
    }
  };

  // Delete selected domains
  const handleBatchDelete = async () => {
    if (selectedDomains.length === 0) {
      alert('Please select domains to delete');
      return;
    }

    if (window.confirm(`Delete ${selectedDomains.length} domain(s)?`)) {
      try {
        const backendOrigin = getBackendOrigin();
        await axios.post(
          `${backendOrigin}/api/domains/batch-delete`,
          { ids: selectedDomains },
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        
        await fetchDomains();
        setSelectedDomains([]);
      } catch (error) {
        console.error('Error deleting domains:', error);
        alert('Failed to delete domains');
      }
    }
  };

  // Toggle domain selection
  const toggleDomainSelection = (id) => {
    setSelectedDomains(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  // Toggle select all
  const toggleSelectAll = () => {
    if (selectedDomains.length === domains.length) {
      setSelectedDomains([]);
    } else {
      setSelectedDomains(domains.map(d => d.id));
    }
  };

  // Start editing a domain
  const handleEdit = (domain) => {
    setEditingId(domain.id);
    setEditingData({ ...domain });
  };

  // Save edited domain
  const handleSaveEdit = async () => {
    try {
      const backendOrigin = getBackendOrigin();
      await axios.put(
        `${backendOrigin}/api/domains/${editingId}`,
        editingData,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      
      await fetchDomains();
      setEditingId(null);
      setEditingData({});
    } catch (error) {
      console.error('Error updating domain:', error);
      alert('Failed to update domain');
    }
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingData({});
  };

  // Delete single domain
  const handleDelete = async (id) => {
    if (window.confirm('Delete this domain?')) {
      try {
        const backendOrigin = getBackendOrigin();
        await axios.delete(
          `${backendOrigin}/api/domains/${id}`,
          {
            headers: { Authorization: `Bearer ${token}` }
          }
        );
        
        await fetchDomains();
      } catch (error) {
        console.error('Error deleting domain:', error);
        alert('Failed to delete domain');
      }
    }
  };

  return (
    <div className="domain-manager-page">
      <div className="page-header">
        <h1>
          <FaGlobe className="title-icon" />
          Domain Manager
        </h1>
      </div>

      {/* Add Domain Form */}
      <div className="domain-form-section">
        <div className="form-row">
          <div className="form-group">
            <label>Domain:</label>
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="example.com"
              className="domain-input"
            />
          </div>

          <div className="form-group">
            <label>Server Region:</label>
            <select
              value={serverRegion}
              onChange={(e) => setServerRegion(e.target.value)}
              className="region-select"
            >
              {regions.map(region => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Service:</label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="service-select"
            >
              <option value="Basic">Basic</option>
              <option value="Premium">Premium</option>
            </select>
          </div>

          <div className="form-group checkbox-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={unlimited}
                onChange={(e) => setUnlimited(e.target.checked)}
              />
              Unlimited
            </label>
          </div>

          <button className="btn-add" onClick={handleAddDomain}>
            <FaPlus /> Add Domain
          </button>
        </div>
      </div>

      {/* Batch Actions */}
      {domains.length > 0 && (
        <div className="batch-actions">
          <button
            className="btn-batch-delete"
            onClick={handleBatchDelete}
            disabled={selectedDomains.length === 0}
          >
            <FaTrash /> Delete Selected ({selectedDomains.length})
          </button>
        </div>
      )}

      {/* Domains Table */}
      {domains.length > 0 ? (
        <div className="domains-table-container">
          <table className="domains-table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedDomains.length === domains.length}
                    onChange={toggleSelectAll}
                  />
                </th>
                <SortTh field="service">Service</SortTh>
                <SortTh field="server">Server</SortTh>
                <SortTh field="domain">Domain</SortTh>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedDomains.map(domain => (
                <tr key={domain.id} className={selectedDomains.includes(domain.id) ? 'selected' : ''}>
                  <td className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectedDomains.includes(domain.id)}
                      onChange={() => toggleDomainSelection(domain.id)}
                    />
                  </td>
                  <td>
                    {editingId === domain.id ? (
                      <div className="edit-service-group">
                        <select
                          value={editingData.service}
                          onChange={(e) => setEditingData({ ...editingData, service: e.target.value })}
                          className="edit-select"
                        >
                          <option value="Basic">Basic</option>
                          <option value="Premium">Premium</option>
                        </select>
                        <label className="edit-checkbox-label">
                          <input
                            type="checkbox"
                            checked={editingData.unlimited}
                            onChange={(e) => setEditingData({ ...editingData, unlimited: e.target.checked })}
                          />
                          Unlimited
                        </label>
                      </div>
                    ) : (
                      <div className="service-display">
                        <span className={`service-badge ${domain.service.toLowerCase()}`}>
                          {domain.service}
                        </span>
                        {domain.unlimited && (
                          <span className="unlimited-tag">Unlimited</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    {editingId === domain.id ? (
                      <input
                        type="text"
                        value={editingData.server}
                        onChange={(e) => setEditingData({ ...editingData, server: e.target.value })}
                        className="edit-input"
                      />
                    ) : (
                      <span className="server-name">{domain.server}</span>
                    )}
                  </td>
                  <td>
                    {editingId === domain.id ? (
                      <input
                        type="text"
                        value={editingData.domain}
                        onChange={(e) => setEditingData({ ...editingData, domain: e.target.value })}
                        className="edit-input"
                      />
                    ) : (
                      <span className="domain-name">{domain.domain}</span>
                    )}
                  </td>
                  <td className="actions-cell">
                    {editingId === domain.id ? (
                      <>
                        <button
                          className="action-btn save-btn"
                          onClick={handleSaveEdit}
                          title="Save"
                        >
                          <FaSave />
                        </button>
                        <button
                          className="action-btn cancel-btn"
                          onClick={handleCancelEdit}
                          title="Cancel"
                        >
                          <FaTimes />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="action-btn edit-btn"
                          onClick={() => handleEdit(domain)}
                          title="Edit"
                        >
                          <FaEdit />
                        </button>
                        <button
                          className="action-btn delete-btn"
                          onClick={() => handleDelete(domain.id)}
                          title="Delete"
                        >
                          <FaTrash />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <FaGlobe className="empty-icon" />
          <p>No domains added yet</p>
          <p className="empty-hint">Add your first domain using the form above</p>
        </div>
      )}
    </div>
  );
};

export default DomainManagerPage;
