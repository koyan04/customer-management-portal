import { useState, useEffect, useCallback } from 'react';
import './SearchPage.css';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { FaSearch, FaExternalLinkAlt, FaClock, FaMagic } from 'react-icons/fa';
import formatWithAppTZ from '../lib/timezone';
import { useNavigate } from 'react-router-dom';

// Simple utility to add months (preserving day when possible) and return YYYY-MM-DD
function addMonths(dateStr, months) {
  if (!dateStr) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  }
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) {
      const parts = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (parts) {
        const y = Number(parts[1]); const m = Number(parts[2]) - 1; const day = Number(parts[3]);
        const d2 = new Date(y, m, day);
        d2.setMonth(d2.getMonth() + months);
        const yy = d2.getFullYear(); const mm = String(d2.getMonth() + 1).padStart(2,'0'); const dd = String(d2.getDate()).padStart(2,'0');
        return `${yy}-${mm}-${dd}`;
      }
      return new Date().toISOString().slice(0,10);
    }
    d.setHours(0,0,0,0);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  } catch (_) {
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0,10);
  }
}

function SearchPage() {
  const { token, user } = useAuth();
  const role = user?.user?.role || user?.role || null;
  const navigate = useNavigate();
  const backendOrigin = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) ? 'http://localhost:3001' : '';
  const [query, setQuery] = useState('');
  const [pendingQuery, setPendingQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extending, setExtending] = useState({}); // id -> boolean
  const [fuzzyEnabled, setFuzzyEnabled] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isDesktop, setIsDesktop] = useState(() => {
    try { return window.innerWidth >= 900; } catch (_) { return true; }
  });

  // track viewport for responsive columns
  useEffect(() => {
    const handler = () => {
      try { setIsDesktop(window.innerWidth >= 900); } catch (_) {}
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Debounced query submit
  useEffect(() => {
    const h = setTimeout(() => setQuery(pendingQuery), 300);
    return () => clearTimeout(h);
  }, [pendingQuery]);

  const performSearch = useCallback(async () => {
    if (!query || query.trim().length < 2) { setResults([]); setError(query ? 'Enter at least 2 characters.' : ''); return; }
    try {
      setLoading(true); setError('');
      const params = { q: query.trim() };
      if (fuzzyEnabled) params.fuzzy = '1';
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await axios.get(`${backendOrigin}/api/users/search`, { params, headers, validateStatus: () => true });
      if (res.status === 200) {
        setResults(Array.isArray(res.data) ? res.data : []);
        setError('');
      } else {
        setResults([]);
        setError(res.data?.msg || 'Search failed');
      }
    } catch (e) {
      setError(e?.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, token, backendOrigin, fuzzyEnabled]);

  useEffect(() => { performSearch(); }, [performSearch]);

  const extendOneMonth = async (u) => {
    if (!u || !token) return;
    setExtending(prev => ({ ...prev, [u.id]: true }));
    try {
      // Build updated payload preserving existing fields
      const newExpire = addMonths(u.expire_date, 1);
      const payload = {
        account_name: u.account_name,
        service_type: u.service_type,
        contact: u.contact || '',
        expire_date: newExpire,
        total_devices: u.total_devices,
        data_limit_gb: u.data_limit_gb,
        remark: u.remark || '',
        display_pos: u.display_pos,
      };
      const res = await axios.put(`${backendOrigin}/api/users/${u.id}`, payload, { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
      if (res.status === 200) {
        // Optimistically update results list
        setResults(r => r.map(x => x.id === u.id ? { ...x, expire_date: newExpire } : x));
      } else {
        setError(res.data?.msg || 'Failed to extend');
      }
    } catch (e) {
      setError(e?.message || 'Failed to extend');
    } finally {
      setExtending(prev => ({ ...prev, [u.id]: false }));
    }
  };

  const bulkExtend = async () => {
    if (!token || selectedIds.size === 0) return;
    // sequential updates to keep it simple (could parallelize later)
    for (const id of Array.from(selectedIds)) {
      const u = results.find(r => r.id === id);
      if (!u) continue;
      await extendOneMonth(u); // reuse logic
    }
    // after bulk extend, clear selection
    setSelectedIds(new Set());
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  
  const allSelected = results.length > 0 && selectedIds.size === results.length;
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(results.map(r => r.id)));
    }
  };

  return (
  <div className={`app-container search-page ${isDesktop ? 'desktop' : ''}`}>
      <div className="admin-header" style={{ marginBottom: '1.25rem' }}>
        <div className="admin-header-left">
          <div className="admin-header-icon"><FaSearch /></div>
          <div>
            <h2 className="admin-title" style={{ margin: 0 }}>Search Users</h2>
            <p className="admin-subtitle" style={{ margin: 0 }}>Find users across all accessible servers</p>
          </div>
        </div>
      </div>
      <div className="search-bar">
        <div className="search-input-wrapper">
          <FaSearch aria-hidden className="search-input-icon" />
          <input
            type="text"
            placeholder="Search account name..."
            value={pendingQuery}
            onChange={(e) => setPendingQuery(e.target.value)}
            className="search-input"
            aria-label="Search account name"
            onKeyDown={(e) => { if (e.key === 'Enter') performSearch(); }}
          />
        </div>
        <label className={`fuzzy-chip ${fuzzyEnabled ? 'active' : ''}`} title="Enable fuzzy matching">
          <input
            type="checkbox"
            checked={fuzzyEnabled}
            onChange={(e) => setFuzzyEnabled(e.target.checked)}
            aria-label="Enable fuzzy matching"
            className="fuzzy-checkbox"
          />
          <FaMagic aria-hidden style={{ opacity: 0.9 }} />
          <span>Fuzzy</span>
        </label>
        <button
          type="button"
          className="search-btn btn"
          onClick={() => performSearch()}
          disabled={loading}
          title="Search"
        >
          {loading ? <div className="spinner" aria-hidden /> : <FaSearch aria-hidden />}
          <span>{loading ? 'Searching…' : 'Search'}</span>
        </button>
        {role === 'ADMIN' && selectedIds.size > 0 && (
          <button
            type="button"
            className="bulk-extend-btn btn"
            onClick={bulkExtend}
            disabled={loading}
            title="Extend selected users by 1 month"
          >
            +1M ({selectedIds.size})
          </button>
        )}
      </div>
      <div className="sr-status" aria-live="polite" style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}>
        {loading ? 'Searching…' : (!error ? (results.length > 0 ? `${results.length} result${results.length===1?'':'s'} loaded.` : (query.trim().length >= 2 ? 'No results.' : '')) : 'Error') }
      </div>
      {error && <div className="form-error" role="alert" style={{ marginBottom: '0.75rem' }}>{error}</div>}
      {loading && <div>Searching…</div>}
      {!loading && results.length === 0 && query.trim().length >= 2 && !error && <div>No results found.</div>}
      {!loading && results.length > 0 && (
        <table className={`user-table compact ${role === 'ADMIN' ? 'admin-table' : ''}`} style={{ marginTop: '0.5rem' }}>
          <thead>
            <tr>
              {role === 'ADMIN' && (
                <th className="col-sel" style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    aria-label={allSelected ? 'Unselect all' : 'Select all'}
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
              )}
              <th className="col-account">Account</th>
              <th className="col-service">Service</th>
              <th className="col-server">Server</th>
              <th className="col-status">Status</th>
              <th className="col-expire">Expire</th>
              {isDesktop && <th className="col-contact">Contact</th>}
              {isDesktop && <th className="col-remark">Remark</th>}
              <th className="col-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {results.map(u => {
              const exp = u.expire_date ? formatWithAppTZ(u.expire_date, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-GB') : '—';
              const status = u.status || 'active';
              return (
                <tr key={u.id} className={selectedIds.has(u.id) ? 'selected' : ''}>
                  {role === 'ADMIN' && (
                    <td className="col-sel" style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        aria-label={selectedIds.has(u.id) ? `Unselect ${u.account_name}` : `Select ${u.account_name}`}
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                    </td>
                  )}
                  <td className="col-account">{u.account_name}</td>
                  <td className="col-service">{u.service_type || '—'}</td>
                  <td className="col-server">{u.server_name || '—'}</td>
                  <td className="col-status">
                    <span className={`status-badge status-${status}`}>{status.toUpperCase()}</span>
                  </td>
                  <td className="col-expire">{exp}</td>
                  {isDesktop && <td className="col-contact">{u.contact || '—'}</td>}
                  {isDesktop && <td className="col-remark remark-cell">{u.remark || '—'}</td>}
                  <td className="col-actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-small btn"
                        onClick={() => navigate(`/servers/${u.server_id}`)}
                        title="Open server"
                      >
                        <FaExternalLinkAlt aria-hidden />
                      </button>
                      {role === 'ADMIN' && (
                        <button
                          type="button"
                          className="btn-small btn"
                          disabled={!!extending[u.id]}
                          onClick={() => extendOneMonth(u)}
                          title="Extend 1 month"
                        >
                          <FaClock aria-hidden /> +1M
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SearchPage;
