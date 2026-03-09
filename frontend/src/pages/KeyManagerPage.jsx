import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FaServer, FaKey, FaCopy, FaTrash, FaPlay, FaStop, FaSync, FaSave, FaEye, FaEyeSlash, FaFolder, FaDownload, FaCog, FaSearch, FaChevronLeft, FaChevronRight, FaAngleDoubleLeft, FaAngleDoubleRight, FaCloudDownloadAlt, FaCloudUploadAlt, FaCheckSquare, FaRegSquare, FaExclamationTriangle, FaBars, FaLink, FaFileImport, FaSortUp, FaSortDown, FaSort } from 'react-icons/fa';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { getBackendOrigin } from '../lib/backendOrigin';
import './KeyManagerPage.css';

const KeyManagerPage = () => {
  const { token, user } = useAuth();
  const role = user?.user?.role || user?.role;
  const isAdmin = role === 'ADMIN';
  const backendOrigin = getBackendOrigin();

  // Key Server config state
  const [port, setPort] = useState(8088);
  const [secretKey, setSecretKey] = useState('');
  const [configDir, setConfigDir] = useState('/srv/cmp/configs');
  const [autoStart, setAutoStart] = useState(false);
  const [publicDomain, setPublicDomain] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [serverStatus, setServerStatus] = useState('stopped');
  const [serverError, setServerError] = useState('');
  const [configDirty, setConfigDirty] = useState(false);

  // Key list state
  const [keys, setKeys] = useState([]);
  const [keysLoading, setKeysLoading] = useState(false);

  // Search, filter & pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all'); // all | yaml | json | txt
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [sortBy, setSortBy] = useState(null); // 'filename' | 'modified' | null
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'

  // Feedback
  const [feedback, setFeedback] = useState({ msg: '', type: '' });
  const [actionLoading, setActionLoading] = useState('');
  const [showConfig, setShowConfig] = useState(false);

  // Preview modal
  const [previewFile, setPreviewFile] = useState(null);
  const [previewContent, setPreviewContent] = useState('');  
  const [previewLoading, setPreviewLoading] = useState(false);

  // Backup/restore
  const restoreInputRef = useRef(null);
  const importInputRef = useRef(null);
  const [restoreModal, setRestoreModal] = useState(null); // null | { backup, filename }
  const [copyModal, setCopyModal] = useState(null);   // null | keyEntry

  // Selection for batch delete
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  // Mobile action menu
  const [openMenu, setOpenMenu] = useState(null); // null | { filename, x, y }

  const headers = { Authorization: `Bearer ${token}` };

  const resolveLightTheme = useCallback(() => {
    try {
      const override = localStorage.getItem('themeOverride');
      if (override === 'light') return true;
      if (override === 'dark') return false;
      if (override === 'system') {
        return window.matchMedia ? !window.matchMedia('(prefers-color-scheme: dark)').matches : document.body.classList.contains('theme-light');
      }
    } catch (_) {
      // Fall through to body class detection.
    }
    return document.body.classList.contains('theme-light');
  }, []);

  const showFeedback = (msg, type = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback({ msg: '', type: '' }), 3000);
  };

  // Fetch config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await axios.get(`${backendOrigin}/api/keyserver/config`, { headers });
      const c = res.data;
      setPort(c.port || 8088);
      setSecretKey(c.secretKey || '');
      setConfigDir(c.configDir || '/srv/cmp/configs');
      setAutoStart(c.autoStart || false);
      setPublicDomain(c.publicDomain || '');
      setConfigDirty(false);
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }, [backendOrigin, token]);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await axios.get(`${backendOrigin}/api/keyserver/status`, { headers });
      setServerStatus(res.data.status);
      setServerError(res.data.error || '');
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  }, [backendOrigin, token]);

  // Fetch keys
  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const res = await axios.get(`${backendOrigin}/api/keyserver/keys`, { headers });
      setKeys(res.data);
    } catch (err) {
      console.error('Failed to load keys:', err);
    } finally {
      setKeysLoading(false);
    }
  }, [backendOrigin, token]);

  useEffect(() => {
    fetchConfig();
    fetchStatus();
    fetchKeys();
  }, [fetchConfig, fetchStatus, fetchKeys]);

  // Poll status every 5s
  useEffect(() => {
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Generate key (client-side with backend fallback)
  const handleGenerateKey = async () => {
    try {
      const res = await axios.post(`${backendOrigin}/api/keyserver/generate-key`, {}, { headers });
      setSecretKey(res.data.key);
      setConfigDirty(true);
    } catch (err) {
      // Fallback: generate client-side
      try {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        const key = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        setSecretKey(key);
        setConfigDirty(true);
      } catch (e2) {
        showFeedback('Failed to generate key', 'error');
      }
    }
  };

  // Save config
  const handleSaveConfig = async () => {
    try {
      await axios.put(`${backendOrigin}/api/keyserver/config`, {
        port, secretKey, configDir, autoStart, publicDomain
      }, { headers });
      setConfigDirty(false);
      showFeedback('Configuration saved');
    } catch (err) {
      showFeedback(err.response?.data?.error || 'Failed to save config', 'error');
    }
  };

  // Server actions
  const handleServerAction = async (action) => {
    setActionLoading(action);
    try {
      const res = await axios.post(`${backendOrigin}/api/keyserver/${action}`, {}, { headers });
      setServerStatus(res.data.status);
      showFeedback(res.data.message);
    } catch (err) {
      showFeedback(err.response?.data?.error || `Failed to ${action}`, 'error');
    } finally {
      setActionLoading('');
    }
  };

  // Delete key
  const handleDeleteKey = async (filename) => {
    if (!window.confirm(`Delete "${filename}"?`)) return;
    try {
      await axios.delete(`${backendOrigin}/api/keyserver/keys/${encodeURIComponent(filename)}`, { headers });
      setKeys(prev => prev.filter(k => k.filename !== filename));
      showFeedback(`Deleted ${filename}`);
    } catch (err) {
      showFeedback('Failed to delete file', 'error');
    }
  };

  // Copy subscription URL using token (hides real filename) and optional public domain
  const copySubUrl = (keyEntry, format = null) => {
    const id = keyEntry.token || keyEntry.filename;
    const normDomain = publicDomain
      ? (publicDomain.match(/^https?:\/\//) ? publicDomain : `http://${publicDomain}`).replace(/\/+$/, '')
      : '';
    const baseHost = normDomain || `http://${window.location.hostname}:${port}`;
    const formatParam = format ? `&format=${format}` : '';
    const url = `${baseHost}/sub/${id}?key=${secretKey}${formatParam}`;
    navigator.clipboard.writeText(url).then(() => {
      showFeedback('URL copied to clipboard');
    }).catch(() => {
      showFeedback('Failed to copy', 'error');
    });
  };

  const openCopyModal = (keyEntry) => setCopyModal({ ...keyEntry, prefersLightTheme: resolveLightTheme() });

  // Build URL for display
  const buildSubUrl = (keyEntry) => {
    const id = keyEntry.token || keyEntry.filename;
    const normDomain = publicDomain
      ? (publicDomain.match(/^https?:\/\//) ? publicDomain : `http://${publicDomain}`).replace(/\/+$/, '')
      : '';
    const baseHost = normDomain || `http://${window.location.hostname}:${port}`;
    return `${baseHost}/sub/${id}?key=${secretKey}`;
  };

  // Preview file
  const handlePreview = async (filename) => {
    setPreviewFile(filename);
    setPreviewLoading(true);
    try {
      const res = await axios.get(`${backendOrigin}/api/keyserver/keys/${encodeURIComponent(filename)}/content`, { headers });
      setPreviewContent(res.data.content);
    } catch (err) {
      setPreviewContent('Failed to load file content');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Download file
  const handleDownload = (filename) => {
    if (previewContent) {
      const blob = new Blob([previewContent], { type: 'text/yaml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  // Backup – download JSON bundle
  const handleBackup = async () => {
    try {
      const res = await axios.get(`${backendOrigin}/api/keyserver/backup`, {
        headers,
        responseType: 'blob',
      });
      const disposition = res.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?(.+?)"?$/i);
      const filename = match ? match[1] : `keymanager-backup-${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.json`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      showFeedback('Backup downloaded');
    } catch (err) {
      showFeedback('Backup failed', 'error');
    }
  };

  // Restore – upload JSON bundle (opens modal for merge/overwrite choice)
  const handleRestoreFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const text = await file.text();
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        return showFeedback('Invalid backup file \u2013 not valid JSON', 'error');
      }
      if (!backup.version || !Array.isArray(backup.files)) {
        return showFeedback('Invalid backup file format', 'error');
      }
      // Open restore modal
      setRestoreModal({ backup, filename: file.name });
    } catch (err) {
      showFeedback('Failed to read backup file', 'error');
    }
  };

  // Execute restore with chosen mode
  const executeRestore = async (mode) => {
    if (!restoreModal) return;
    const { backup } = restoreModal;
    setRestoreModal(null);
    try {
      const res = await axios.post(`${backendOrigin}/api/keyserver/restore`, { backup, mode }, { headers });
      showFeedback(res.data.message);
      fetchConfig();
      fetchKeys();
    } catch (err) {
      showFeedback(err.response?.data?.error || 'Restore failed', 'error');
    }
  };

  // Selection helpers
  const toggleSelect = (filename) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedKeys.size === filteredKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(filteredKeys.map(k => k.filename)));
    }
  };

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedKeys.size === 0) return;
    if (!window.confirm(`Delete ${selectedKeys.size} selected file(s)?`)) return;
    try {
      const res = await axios.post(`${backendOrigin}/api/keyserver/keys/batch-delete`, {
        filenames: [...selectedKeys]
      }, { headers });
      showFeedback(res.data.message);
      setKeys(prev => prev.filter(k => !selectedKeys.has(k.filename)));
      setSelectedKeys(new Set());
    } catch (err) {
      showFeedback(err.response?.data?.error || 'Batch delete failed', 'error');
    }
  };

  // Delete all
  const handleDeleteAll = async () => {
    if (keys.length === 0) return;
    if (!window.confirm(`Delete ALL ${keys.length} config file(s)? This cannot be undone.`)) return;
    try {
      const res = await axios.post(`${backendOrigin}/api/keyserver/keys/batch-delete`, {
        filenames: keys.map(k => k.filename)
      }, { headers });
      showFeedback(res.data.message);
      setKeys([]);
      setSelectedKeys(new Set());
    } catch (err) {
      showFeedback(err.response?.data?.error || 'Delete all failed', 'error');
    }
  };

  // Clear selection when keys change
  useEffect(() => {
    setSelectedKeys(new Set());
  }, [keys]);

  // Import external key files
  const handleImportFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = '';

    let imported = 0;
    let failed = 0;
    for (const file of files) {
      try {
        const content = await file.text();
        await axios.post(`${backendOrigin}/api/keyserver/keys`, {
          filename: file.name,
          content,
        }, { headers });
        imported++;
      } catch {
        failed++;
      }
    }
    showFeedback(`Imported ${imported} file(s)${failed ? `, ${failed} failed` : ''}`);
    fetchKeys();
  };

  // Close mobile menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = () => setOpenMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [openMenu]);

  const toggleMenu = (filename, e) => {
    e.stopPropagation();
    if (openMenu && openMenu.filename === filename) {
      setOpenMenu(null);
    } else {
      setOpenMenu({ filename, prefersLightTheme: resolveLightTheme() });
    }
  };

  const statusColor = serverStatus === 'running' ? '#4caf50' : serverStatus === 'error' ? '#f44336' : '#888';
  const statusLabel = serverStatus.charAt(0).toUpperCase() + serverStatus.slice(1);

  // Filtered + sorted + paginated keys
  const filteredKeys = useMemo(() => {
    let result = keys;
    // Filter by type
    if (filterType === 'yaml') {
      result = result.filter(k => /\.(ya?ml)$/i.test(k.filename));
    } else if (filterType === 'json') {
      result = result.filter(k => /\.json$/i.test(k.filename));
    } else if (filterType === 'txt') {
      result = result.filter(k => /\.txt$/i.test(k.filename));
    }
    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(k => k.filename.toLowerCase().includes(q));
    }
    // Sort
    if (sortBy) {
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'filename') {
          cmp = a.filename.localeCompare(b.filename);
        } else if (sortBy === 'modified') {
          cmp = new Date(a.modified) - new Date(b.modified);
        }
        return sortDir === 'desc' ? -cmp : cmp;
      });
    }
    return result;
  }, [keys, filterType, searchQuery, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredKeys.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedKeys = useMemo(() => {
    const start = (safePage - 1) * itemsPerPage;
    return filteredKeys.slice(start, start + itemsPerPage);
  }, [filteredKeys, safePage, itemsPerPage]);

  // Reset page when search/filter/sort changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterType, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortBy(null); setSortDir('asc'); }
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <FaSort className="km-sort-icon km-sort-inactive" />;
    return sortDir === 'asc'
      ? <FaSortUp className="km-sort-icon km-sort-active" />
      : <FaSortDown className="km-sort-icon km-sort-active" />;
  };

  return (
    <div className="km-container">
      <h2 className="km-title"><FaKey className="km-title-icon" /> Key Manager</h2>

      {feedback.msg && (
        <div className={`km-feedback km-feedback-${feedback.type}`}>{feedback.msg}</div>
      )}

      {/* ─── Key Server Section ─── */}
      <div className="km-section km-server-section">
        <div className="km-section-header">
          <h3 className="km-section-title"><FaServer /> Key Server</h3>
          <div className="km-header-right">
            <span className="km-status-indicator">
              <span className="km-status-dot" style={{ background: statusColor }} />
              <span className="km-status-text" style={{ color: statusColor }}>{statusLabel}</span>
            </span>
            {serverError && <span className="km-status-error">{serverError}</span>}
            {isAdmin && (
            <button
              className={`km-btn km-btn-icon km-btn-config${showConfig ? ' active' : ''}`}
              onClick={() => setShowConfig(v => !v)}
              title="Server Configuration"
            >
              <FaCog />
            </button>
            )}
          </div>
        </div>

        {isAdmin && showConfig && (
        <div className="km-server-grid">
          {/* Port */}
          <div className="km-field-row">
            <label className="km-label" htmlFor="km-port">Service Port</label>
            <input
              id="km-port"
              type="number"
              className="km-input km-input-port"
              value={port}
              onChange={e => { setPort(parseInt(e.target.value) || 8088); setConfigDirty(true); }}
              min={1}
              max={65535}
            />
          </div>

          {/* Secret Key */}
          <div className="km-field-row">
            <label className="km-label" htmlFor="km-secret">Secret Key</label>
            <div className="km-key-input-group">
              <input
                id="km-secret"
                type={showKey ? 'text' : 'password'}
                className="km-input km-input-key"
                value={secretKey}
                onChange={e => { setSecretKey(e.target.value); setConfigDirty(true); }}
                placeholder="Generate or enter secret key"
              />
              <button
                type="button"
                className="km-btn km-btn-icon"
                onClick={() => setShowKey(v => !v)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <FaEyeSlash /> : <FaEye />}
              </button>
              <button
                type="button"
                className="km-btn km-btn-generate"
                onClick={handleGenerateKey}
                title="Generate random key"
              >
                <FaSync /> Generate
              </button>
            </div>
          </div>

          {/* Config Directory */}
          <div className="km-field-row">
            <label className="km-label" htmlFor="km-configdir">Config Directory</label>
            <div className="km-key-input-group">
              <FaFolder className="km-folder-icon" />
              <input
                id="km-configdir"
                type="text"
                className="km-input km-input-dir"
                value={configDir}
                onChange={e => { setConfigDir(e.target.value); setConfigDirty(true); }}
                placeholder="/srv/cmp/configs"
              />
            </div>
          </div>

          {/* Public Domain */}
          <div className="km-field-row">
            <label className="km-label" htmlFor="km-publicdomain">Public Domain</label>
            <div className="km-key-input-group">
              <FaLink className="km-folder-icon" />
              <input
                id="km-publicdomain"
                type="text"
                className="km-input km-input-dir"
                value={publicDomain}
                onChange={e => { setPublicDomain(e.target.value); setConfigDirty(true); }}
                placeholder="https://sub.yourdomain.com (leave empty to use IP:port)"
              />
            </div>
            <span className="km-field-hint">If set, subscription URLs use this instead of IP:port</span>
          </div>

          {/* Auto Start */}
          <div className="km-field-row km-field-row-checkbox">
            <label className="km-checkbox-label">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={e => { setAutoStart(e.target.checked); setConfigDirty(true); }}
              />
              <span>Auto-start on server boot</span>
            </label>
          </div>
        </div>
        )}

        {/* Action Buttons */}
        {isAdmin && showConfig && (
        <div className="km-actions">
          <button
            className={`km-btn km-btn-save${configDirty ? ' km-btn-dirty' : ''}`}
            onClick={handleSaveConfig}
            title="Save configuration"
          >
            <FaSave /> Save
          </button>
          <div className="km-server-controls">
            <button
              className="km-btn km-btn-start"
              onClick={() => handleServerAction('start')}
              disabled={actionLoading === 'start' || serverStatus === 'running'}
              title="Start key server"
            >
              <FaPlay /> {actionLoading === 'start' ? 'Starting...' : 'Start'}
            </button>
            <button
              className="km-btn km-btn-stop"
              onClick={() => handleServerAction('stop')}
              disabled={actionLoading === 'stop' || serverStatus === 'stopped'}
              title="Stop key server"
            >
              <FaStop /> {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
            </button>
            <button
              className="km-btn km-btn-restart"
              onClick={() => handleServerAction('restart')}
              disabled={actionLoading === 'restart'}
              title="Restart key server"
            >
              <FaSync /> {actionLoading === 'restart' ? 'Restarting...' : 'Restart'}
            </button>
          </div>
        </div>
        )}
      </div>

      {/* ─── Key List Section ─── */}
      <div className="km-section km-keys-section">
        <div className="km-keys-header">
          <h3 className="km-section-title"><FaKey /> Key List</h3>
          <div className="km-keys-header-actions">
            <button className="km-btn km-btn-import" onClick={() => importInputRef.current?.click()} title="Import key files">
              <FaFileImport /> Import
            </button>
            <input
              type="file"
              ref={importInputRef}
              accept=".yaml,.yml,.json"
              multiple
              style={{ display: 'none' }}
              onChange={handleImportFiles}
            />
            <button className="km-btn km-btn-backup" onClick={handleBackup} title="Backup config & keys">
              <FaCloudDownloadAlt /> Backup
            </button>
            <button className="km-btn km-btn-restore" onClick={() => restoreInputRef.current?.click()} title="Restore from backup">
              <FaCloudUploadAlt /> Restore
            </button>
            <input
              type="file"
              ref={restoreInputRef}
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleRestoreFile}
            />
            <button className="km-btn km-btn-refresh" onClick={fetchKeys} title="Refresh">
              <FaSync /> Refresh
            </button>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="km-search-bar">
          <div className="km-search-input-wrap">
            <FaSearch className="km-search-icon" />
            <input
              type="text"
              className="km-input km-search-input"
              placeholder="Search by filename..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="km-search-clear" onClick={() => setSearchQuery('')} title="Clear">✕</button>
            )}
          </div>
          <div className="km-filter-btns">
            {['all', 'yaml', 'json', 'txt'].map(t => (
              <button
                key={t}
                className={`km-btn km-btn-filter${filterType === t ? ' active' : ''}`}
                onClick={() => setFilterType(t)}
              >
                {t === 'all' ? 'All' : t === 'yaml' ? 'YAML' : t === 'json' ? 'JSON' : 'TXT'}
              </button>
            ))}
          </div>
          <span className="km-result-count">{filteredKeys.length} file{filteredKeys.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Batch Actions Bar */}
        {filteredKeys.length > 0 && (
          <div className="km-batch-bar">
            <label className="km-batch-select-all" title="Select all">
              <input
                type="checkbox"
                checked={filteredKeys.length > 0 && selectedKeys.size === filteredKeys.length}
                onChange={toggleSelectAll}
              />
              <span>{selectedKeys.size > 0 ? `${selectedKeys.size} selected` : 'Select all'}</span>
            </label>
            {selectedKeys.size > 0 && (
              <button className="km-btn km-btn-sm km-btn-batch-delete" onClick={handleBatchDelete}>
                <FaTrash /> Delete Selected ({selectedKeys.size})
              </button>
            )}
            <button className="km-btn km-btn-sm km-btn-delete-all" onClick={handleDeleteAll} title="Delete all config files">
              <FaExclamationTriangle /> Delete All
            </button>
          </div>
        )}

        {keysLoading ? (
          <div className="km-loading">Loading...</div>
        ) : filteredKeys.length === 0 ? (
          <div className="km-empty">
            {keys.length === 0
              ? 'No config files found. Save YAML configs from the YAML Generator to populate this list.'
              : 'No files match the current search / filter.'}
          </div>
        ) : (
          <>
          <div className="km-table-wrap">
            <table className="km-table">
              <thead>
                <tr>
                  <th className="km-th-check">
                    <input
                      type="checkbox"
                      checked={filteredKeys.length > 0 && selectedKeys.size === filteredKeys.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="km-th-num">#</th>
                  <th className="km-th-filename km-th-sortable" onClick={() => toggleSort('filename')}>
                    Filename <SortIcon col="filename" />
                  </th>
                  <th className="km-th-hide-mobile km-th-compact">Size</th>
                  <th className="km-th-hide-mobile km-th-compact km-th-sortable" onClick={() => toggleSort('modified')}>
                    Modified <SortIcon col="modified" />
                  </th>
                  <th className="km-th-compact">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedKeys.map((k, i) => (
                  <tr key={k.filename} className={selectedKeys.has(k.filename) ? 'km-row-selected' : ''}>
                    <td className="km-td-check">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(k.filename)}
                        onChange={() => toggleSelect(k.filename)}
                      />
                    </td>
                    <td>{(safePage - 1) * itemsPerPage + i + 1}</td>
                    <td className="km-td-filename"><span className="km-filename" title={k.filename}>{k.filename}</span></td>
                    <td className="km-td-hide-mobile">{formatSize(k.size)}</td>
                    <td className="km-td-hide-mobile">{formatDate(k.modified)}</td>
                    <td className="km-actions-cell">
                      {/* Desktop buttons */}
                      <div className="km-actions-desktop">
                        <button
                          className="km-btn km-btn-sm km-btn-copy"
                          onClick={() => openCopyModal(k)}
                          title="Copy subscription URL"
                        >
                          <FaCopy />
                        </button>
                        <button
                          className="km-btn km-btn-sm km-btn-preview"
                          onClick={() => handlePreview(k.filename)}
                          title="Preview"
                        >
                          <FaEye />
                        </button>
                        <button
                          className="km-btn km-btn-sm km-btn-delete"
                          onClick={() => handleDeleteKey(k.filename)}
                          title="Delete"
                        >
                          <FaTrash />
                        </button>
                      </div>
                      {/* Mobile hamburger menu */}
                      <div className="km-actions-mobile">
                        <button
                          className="km-btn km-btn-sm km-btn-menu"
                          onClick={e => toggleMenu(k.filename, e)}
                          title="Actions"
                        >
                          <FaBars />
                        </button>
                        {openMenu && openMenu.filename === k.filename && (
                          <div
                            className={`km-popup-menu ${openMenu.prefersLightTheme ? 'km-ui-light' : 'km-ui-dark'}`}
                            onClick={e => e.stopPropagation()}
                          >
                            <button className="km-popup-item" onClick={() => { openCopyModal(k); setOpenMenu(null); }}>
                              <FaLink /> Copy URL
                            </button>
                            <button className="km-popup-item" onClick={() => { handlePreview(k.filename); setOpenMenu(null); }}>
                              <FaEye /> Preview
                            </button>
                            <button className="km-popup-item km-popup-item-danger" onClick={() => { handleDeleteKey(k.filename); setOpenMenu(null); }}>
                              <FaTrash /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="km-pagination">
              <button
                className="km-btn km-btn-page"
                onClick={() => setCurrentPage(1)}
                disabled={safePage <= 1}
                title="First page"
              ><FaAngleDoubleLeft /></button>
              <button
                className="km-btn km-btn-page"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                title="Previous page"
              ><FaChevronLeft /></button>

              {(() => {
                const pages = [];
                let start = Math.max(1, safePage - 2);
                let end = Math.min(totalPages, start + 4);
                if (end - start < 4) start = Math.max(1, end - 4);
                for (let p = start; p <= end; p++) {
                  pages.push(
                    <button
                      key={p}
                      className={`km-btn km-btn-page${p === safePage ? ' active' : ''}`}
                      onClick={() => setCurrentPage(p)}
                    >{p}</button>
                  );
                }
                return pages;
              })()}

              <button
                className="km-btn km-btn-page"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
                title="Next page"
              ><FaChevronRight /></button>
              <button
                className="km-btn km-btn-page"
                onClick={() => setCurrentPage(totalPages)}
                disabled={safePage >= totalPages}
                title="Last page"
              ><FaAngleDoubleRight /></button>

              <select
                className="km-input km-page-size"
                value={itemsPerPage}
                onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              >
                {[5, 10, 20, 50].map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          )}
          </>
        )}
      </div>

      {/* ─── Preview Modal ─── */}
      {previewFile && (
        <div className="km-modal-overlay" onClick={() => setPreviewFile(null)}>
          <div className="km-modal" onClick={e => e.stopPropagation()}>
            <div className="km-modal-header">
              <h4>{previewFile}</h4>
              <div className="km-modal-actions">
                <button className="km-btn km-btn-sm" onClick={() => handleDownload(previewFile)} title="Download">
                  <FaDownload />
                </button>
                <button className="km-btn km-btn-sm" onClick={() => {
                  navigator.clipboard.writeText(previewContent);
                  showFeedback('Content copied');
                }} title="Copy content">
                  <FaCopy />
                </button>
                <button className="km-btn km-btn-sm km-btn-close" onClick={() => setPreviewFile(null)}>✕</button>
              </div>
            </div>
            <div className="km-modal-body">
              {previewLoading ? (
                <div className="km-loading">Loading...</div>
              ) : (
                <pre className="km-preview-content">{previewContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}
      {/* ─── Restore Modal ─── */}
      {copyModal && (
        <div className="km-modal-overlay" onClick={() => setCopyModal(null)}>
          <div className={`km-modal km-copy-modal ${copyModal.prefersLightTheme ? 'km-ui-light' : 'km-ui-dark'}`} onClick={e => e.stopPropagation()}>
            <div className="km-modal-header">
              <span>Copy Subscription URL</span>
              <button className="km-btn km-btn-sm km-btn-close" onClick={() => setCopyModal(null)}>✕</button>
            </div>
            <div className="km-modal-body km-copy-body">
              <p className="km-copy-filename">{copyModal.filename}</p>
              <p className="km-copy-hint">Choose the format to copy:</p>
              <div className="km-copy-options">
                {copyModal.filename.endsWith('.txt') ? (
                  <button className="km-copy-option km-copy-option--v2box" onClick={() => { copySubUrl(copyModal); setCopyModal(null); }}>
                    <span className="km-copy-opt-label">V2Box Subscription</span>
                    <span className="km-copy-opt-desc">Plain-text proxy URI list (//profile headers)</span>
                  </button>
                ) : (
                  <>
                    <button className="km-copy-option km-copy-option--base64" onClick={() => { copySubUrl(copyModal); setCopyModal(null); }}>
                      <span className="km-copy-opt-label">Default (Base64 URIs)</span>
                      <span className="km-copy-opt-desc">Subscription URL — all proxies, works with V2Box, Hiddify, Nekoray</span>
                    </button>
                    <button className="km-copy-option km-copy-option--singbox" onClick={() => { copySubUrl(copyModal, 'raw'); setCopyModal(null); }}>
                      <span className="km-copy-opt-label">Sing-box JSON</span>
                      <span className="km-copy-opt-desc">Download raw sing-box config for sing-box / Hiddify import</span>
                    </button>
                    <button className="km-copy-option km-copy-option--v2ray" onClick={() => { copySubUrl(copyModal, 'v2ray'); setCopyModal(null); }}>
                      <span className="km-copy-opt-label">V2Ray / Xray JSON</span>
                      <span className="km-copy-opt-desc">Download V2Ray config with all servers — for V2Box / V2RayNG import</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {restoreModal && (
        <div className="km-modal-overlay" onClick={() => setRestoreModal(null)}>
          <div className="km-modal km-restore-modal" onClick={e => e.stopPropagation()}>
            <div className="km-modal-header">
              <h4><FaCloudUploadAlt /> Restore Backup</h4>
              <button className="km-btn km-btn-sm km-btn-close" onClick={() => setRestoreModal(null)}>✕</button>
            </div>
            <div className="km-modal-body km-restore-body">
              <div className="km-restore-info">
                <p><strong>File:</strong> {restoreModal.filename}</p>
                <p><strong>Date:</strong> {restoreModal.backup.createdAt ? new Date(restoreModal.backup.createdAt).toLocaleString() : 'Unknown'}</p>
                <p><strong>Config:</strong> {restoreModal.backup.config ? 'Included' : 'Not included'}</p>
                <p><strong>Files:</strong> {restoreModal.backup.files.length} key file(s)</p>
              </div>
              <div className="km-restore-options">
                <h5>Choose restore mode:</h5>
                <button className="km-btn km-btn-restore-merge" onClick={() => executeRestore('merge')}>
                  <FaSave /> Merge
                  <span className="km-restore-desc">Keep existing files, only add new ones</span>
                </button>
                <button className="km-btn km-btn-restore-overwrite" onClick={() => executeRestore('overwrite')}>
                  <FaExclamationTriangle /> Overwrite
                  <span className="km-restore-desc">Delete all existing files and replace with backup</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default KeyManagerPage;
