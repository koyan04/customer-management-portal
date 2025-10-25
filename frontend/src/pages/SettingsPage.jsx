import React, { useEffect, useMemo, useState } from 'react';
import InfoModal from '../components/InfoModal.jsx';
import { FaInfoCircle } from 'react-icons/fa';
import axios from 'axios';
import { useAuth } from '../context/AuthContext.jsx';
import { FaSave, FaFlask, FaSyncAlt, FaDatabase, FaRobot, FaServer, FaCloudDownloadAlt } from 'react-icons/fa';
import { MdTune } from 'react-icons/md';

export default function SettingsPage() {
  // Persist last selected tab
  const initialTab = useMemo(() => {
    try { return localStorage.getItem('settings.lastTab') || 'database'; } catch (_) { return 'database'; }
  }, []);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { try { localStorage.setItem('settings.lastTab', tab); } catch (_) {} }, [tab]);

  // auth and API base
  const { token } = useAuth();
  const backendOrigin = useMemo(() => (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '', []);
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // form states
  const [dbForm, setDbForm] = useState({ host: '', port: 5432, user: '', password: '', database: '', ssl: false });
  const [generalForm, setGeneralForm] = useState({
    title: '',
    theme: 'system',
    showTooltips: true,
    logo_url: '',
    logo_url_2x: '',
    autoLogoutMinutes: 0,
    // Financial / pricing
    price_mini: 0,
    price_basic: 0,
    price_unlimited: 0,
    currency: 'USD',
  });
  const [logoPreview, setLogoPreview] = useState('');
  const [logoPreview2x, setLogoPreview2x] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [tgForm, setTgForm] = useState({ botToken: '', defaultChatId: '', messageTemplate: '' });
  const [rsForm, setRsForm] = useState({ host: '', port: 22, username: '', authMethod: 'password', password: '', privateKey: '', passphrase: '' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [dbStatus, setDbStatus] = useState(null);

  // helpers
  const showMsg = (msg) => { setStatusMsg(msg); setTimeout(() => setStatusMsg(''), 4000); };
  const currentForm = tab === 'database' ? dbForm : tab === 'telegram' ? tgForm : tab === 'general' ? generalForm : rsForm;
  const setCurrentForm = (next) => {
    if (tab === 'database') setDbForm(next);
    else if (tab === 'telegram') setTgForm(next);
    else if (tab === 'general') setGeneralForm(next);
    else setRsForm(next);
  };

  const fetchSettings = async (which) => {
    const key = which || tab;
    setLoading(true);
    try {
      const res = await axios.get(backendOrigin + `/api/admin/settings/${key}`, { headers: authHeaders });
    const data = (res.data && res.data.data) || {};
  if (key === 'database') setDbForm({ host: data.host || '', port: data.port || 5432, user: data.user || '', password: '', database: data.database || '', ssl: !!data.ssl });
  if (key === 'general') setGeneralForm(prev => {
    // read localStorage fallback for autoLogoutMinutes (so reloads preserve user-saved value)
    let localVal;
    try { const s = localStorage.getItem('autoLogoutMinutes'); localVal = (s !== null && s !== undefined) ? Number(s) : undefined; } catch (_) { localVal = undefined; }
    const resolvedAuto = typeof data.autoLogoutMinutes === 'number'
      ? data.autoLogoutMinutes
      : (typeof data.autoLogoutMinutes !== 'undefined'
        ? (data.autoLogoutMinutes ? Number(data.autoLogoutMinutes) : 0)
        : (typeof localVal === 'number' ? localVal : (typeof prev.autoLogoutMinutes === 'number' ? prev.autoLogoutMinutes : 0)));
    return {
      title: data.title || prev.title || '',
      theme: data.theme || prev.theme || 'system',
      showTooltips: typeof data.showTooltips === 'boolean' ? data.showTooltips : (typeof prev.showTooltips === 'boolean' ? prev.showTooltips : true),
      logo_url: data.logo_url || prev.logo_url || '',
      logo_url_2x: data.logo_url_2x || prev.logo_url_2x || '',
      autoLogoutMinutes: resolvedAuto,
  // pricing (server now stores integer cents as price_*_cents); convert to decimals for UI
  price_mini: (typeof data.price_mini_cents !== 'undefined' && data.price_mini_cents !== null) ? Number(data.price_mini_cents) / 100 : ((typeof data.price_mini !== 'undefined' && data.price_mini !== null) ? Number(data.price_mini) : (prev.price_mini || 0)),
  price_basic: (typeof data.price_basic_cents !== 'undefined' && data.price_basic_cents !== null) ? Number(data.price_basic_cents) / 100 : ((typeof data.price_basic !== 'undefined' && data.price_basic !== null) ? Number(data.price_basic) : (prev.price_basic || 0)),
  price_unlimited: (typeof data.price_unlimited_cents !== 'undefined' && data.price_unlimited_cents !== null) ? Number(data.price_unlimited_cents) / 100 : ((typeof data.price_unlimited !== 'undefined' && data.price_unlimited !== null) ? Number(data.price_unlimited) : (prev.price_unlimited || 0)),
    currency: data.currency || prev.currency || 'USD',
    };
  });
      if (key === 'telegram') setTgForm({ botToken: data.botToken || '', defaultChatId: data.defaultChatId || '', messageTemplate: data.messageTemplate || '' });
      if (key === 'remoteServer') setRsForm({ host: data.host || '', port: data.port || 22, username: data.username || '', authMethod: data.authMethod || 'password', password: '', privateKey: '', passphrase: '' });
    } catch (err) {
      showMsg(`Failed to load ${key} settings: ` + (err.response?.data?.msg || err.message));
    } finally { setLoading(false); }
  };

  // load all on mount so switching tabs is instant
  useEffect(() => { fetchSettings('database'); fetchSettings('telegram'); fetchSettings('remoteServer'); fetchSettings('general'); }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rs = await axios.get(backendOrigin + '/api/admin/db/status', { headers: authHeaders });
        if (!cancelled) setDbStatus(rs.data);
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [backendOrigin, authHeaders]);

  const onSave = async () => {
    setSaving(true);
    try {
      const key = tab === 'database' ? 'database' : tab === 'telegram' ? 'telegram' : tab === 'general' ? 'general' : 'remoteServer';
      const payload = currentForm;
      // Optimistically persist autoLogoutMinutes and broadcast so running clients pick it up immediately
      if (key === 'general' && typeof payload.autoLogoutMinutes !== 'undefined') {
        try { localStorage.setItem('autoLogoutMinutes', String(Number.isNaN(Number(payload.autoLogoutMinutes)) ? 0 : Number(payload.autoLogoutMinutes))); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
      }
      // Ensure cents fields are included to be explicit and avoid accidental loss
      const sendPayload = { ...payload };
      if (key === 'general') {
        const asNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 };
        try {
          if (typeof sendPayload.price_mini !== 'undefined') sendPayload.price_mini_cents = Math.round(asNumber(sendPayload.price_mini) * 100);
          if (typeof sendPayload.price_basic !== 'undefined') sendPayload.price_basic_cents = Math.round(asNumber(sendPayload.price_basic) * 100);
          if (typeof sendPayload.price_unlimited !== 'undefined') sendPayload.price_unlimited_cents = Math.round(asNumber(sendPayload.price_unlimited) * 100);
        } catch (_) {}
      }
      const putRes = await axios.put(backendOrigin + `/api/admin/settings/${key}`, sendPayload, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
      showMsg('Saved successfully');
      // reload to get masked view
      await fetchSettings(key);
      // If general settings saved, broadcast immediate update
      if (key === 'general') {
        const serverData = (putRes && putRes.data && putRes.data.data) ? putRes.data.data : payload;
        // Ensure autoLogoutMinutes is persisted locally even if the server response omitted it
        const savedVal = (typeof serverData.autoLogoutMinutes !== 'undefined') ? serverData.autoLogoutMinutes : (typeof payload.autoLogoutMinutes !== 'undefined' ? payload.autoLogoutMinutes : undefined);
        if (typeof savedVal !== 'undefined' && savedVal !== null) {
          const parsed = Number(savedVal);
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            try { localStorage.setItem('autoLogoutMinutes', String(parsed)); } catch (_) {}
          }
        }
        // include the persisted value in the broadcast detail so listeners get an explicit field
        const broadcast = { ...serverData, ...(typeof savedVal !== 'undefined' ? { autoLogoutMinutes: Number(savedVal) } : {}) };
        try { localStorage.setItem('general_refresh', String(Date.now())); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: broadcast })); } catch (_) {}
      }
    } catch (err) {
      const errors = err.response?.data?.errors;
      showMsg('Save failed: ' + (errors ? errors.join(', ') : (err.response?.data?.msg || err.message)));
    } finally { setSaving(false); }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const key = tab === 'database' ? 'database' : tab === 'telegram' ? 'telegram' : tab === 'general' ? 'general' : 'remoteServer';
      const res = await axios.post(backendOrigin + `/api/admin/settings/${key}/test`, currentForm, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
      const d = res.data || {};
      if (d.ok) showMsg('Test OK: ' + (d.details || 'Success'));
      else showMsg('Test failed: ' + (d.error || d.details || 'Unknown error'));
    } catch (err) {
      showMsg('Test failed: ' + (err.response?.data?.error || err.response?.data?.msg || err.message));
    } finally { setTesting(false); }
  };

  const onClearLogo = async () => {
    try {
      setBusy(true);
      await axios.delete(backendOrigin + '/api/admin/settings/general/logo', { headers: authHeaders });
      setGeneralForm(g => ({ ...g, logo_url: '', logo_url_2x: '' }));
      setLogoPreview('');
      setLogoPreview2x('');
      showMsg('Logo cleared');
      const payload = { ...generalForm, logo_url: '', logo_url_2x: '' };
      try { localStorage.setItem('general_refresh', String(Date.now())); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
    } catch (err) {
      showMsg('Clear logo failed: ' + (err.response?.data?.msg || err.message));
    } finally { setBusy(false); }
  };

  // --- Backup / Restore helpers (database tab) ---
  const download = async (url, filename) => {
    try {
      setBusy(true);
      const res = await axios.get(url, { headers: authHeaders, responseType: 'blob' });
      const blob = new Blob([res.data]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showMsg('Download started');
    } catch (err) {
      showMsg('Download failed: ' + (err.response?.data?.msg || err.message));
    } finally { setBusy(false); }
  };

  const uploadFile = async (url, file) => {
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    try {
      const res = await axios.post(url, form, { headers: { ...authHeaders } });
      showMsg(res.data?.msg || 'Upload completed');
    } catch (err) {
      showMsg('Upload failed: ' + (err.response?.data?.msg || err.message));
    } finally { setBusy(false); }
  };

  // Let server generate crisp 1x/2x; no client downscaling to avoid double compression
  const passThrough = async (file) => file;

  const onLogoChange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
  // pass original; server creates optimized 1x/2x
  const small = await passThrough(f);
      const form = new FormData();
      form.append('logo', small, small.name);
      setBusy(true);
  const res = await axios.post(backendOrigin + '/api/admin/settings/general/logo', form, { headers: authHeaders });
  const url = res.data?.url || '';
  const url2x = res.data?.url2x || '';
  setGeneralForm(g => ({ ...g, logo_url: res.data?.logo_url || g.logo_url, logo_url_2x: res.data?.logo_url_2x || g.logo_url_2x }));
  // store 1x/2x for immediate preview; header will update via event
  setLogoPreview(url);
  setLogoPreview2x(url2x || '');
      showMsg('Logo uploaded');
      // broadcast updated general settings so header refreshes immediately
      const payload = { ...generalForm, logo_url: res.data?.logo_url || generalForm.logo_url, logo_url_2x: res.data?.logo_url_2x || generalForm.logo_url_2x };
      try { localStorage.setItem('general_refresh', String(Date.now())); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
    } catch (err) {
      showMsg('Logo upload failed: ' + (err.response?.data?.msg || err.message));
    } finally { setBusy(false); }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2>Settings</h2>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Settings Tabs">
        <button
          role="tab"
          aria-selected={tab === 'general'}
          id="tab-general"
          aria-controls="panel-general"
          className={`tab-btn${tab === 'general' ? ' active' : ''}`}
          onClick={() => setTab('general')}
        >
          <MdTune aria-hidden className="tab-icon" />
          <span className="tab-text">General</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'database'}
          id="tab-database"
          aria-controls="panel-database"
          className={`tab-btn${tab === 'database' ? ' active' : ''}`}
          onClick={() => setTab('database')}
        >
          <FaDatabase aria-hidden className="tab-icon" />
          <span className="tab-text">Database</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'telegram'}
          id="tab-telegram"
          aria-controls="panel-telegram"
          className={`tab-btn${tab === 'telegram' ? ' active' : ''}`}
          onClick={() => setTab('telegram')}
        >
          <FaRobot aria-hidden className="tab-icon" />
          <span className="tab-text">Telegram Bot</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'remote'}
          id="tab-remote"
          aria-controls="panel-remote"
          className={`tab-btn${tab === 'remote' ? ' active' : ''}`}
          onClick={() => setTab('remote')}
        >
          <FaServer aria-hidden className="tab-icon" />
          <span className="tab-text">Remote Server</span>
        </button>
      </div>

      <div className="settings-content">
        {statusMsg && <div className="settings-status" role="status" aria-live="polite">{statusMsg}</div>}

        {tab === 'general' && (
          <div role="tabpanel" id="panel-general" aria-labelledby="tab-general" className="tab-panel">
            <h3>General Settings</h3>
            <div className="form-grid">
              <label className="full">
                <span>Title</span>
                <input type="text" value={generalForm.title} onChange={(e) => setGeneralForm({ ...generalForm, title: e.target.value })} />
              </label>
              <div className="general-group">
                <label className="theme-field">
                <span>Theme</span>
                <select value={generalForm.theme} onChange={(e) => setGeneralForm({ ...generalForm, theme: e.target.value })}>
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              
              <label className="logo-field">
                <span>Logo (70x70)</span>
                <input type="file" accept="image/*" onChange={onLogoChange} />
                <div className="logo-preview-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <div style={{ width: 70, height: 70, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    { (logoPreview || generalForm.logo_url) ? (
                      <img
                        src={logoPreview || (backendOrigin + generalForm.logo_url)}
                        srcSet={
                          logoPreview2x
                            ? `${logoPreview} 1x, ${logoPreview2x} 2x`
                            : (generalForm.logo_url_2x ? `${backendOrigin + generalForm.logo_url} 1x, ${backendOrigin + generalForm.logo_url_2x} 2x` : undefined)
                        }
                        sizes="70px"
                        alt="Logo preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: 36, height: 36, borderRadius: '999px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }} />
                    )}
                  </div>
                  <small style={{ opacity: 0.85 }}>Optimized to 70x70 for best performance</small>
                  {(logoPreview || generalForm.logo_url) && (
                    <button type="button" className="btn" onClick={onClearLogo} disabled={busy} style={{ marginLeft: '0.5rem' }}>
                      Clear Logo
                    </button>
                  )}
                </div>
              </label>
              </div>
              <div className="auto-group-wrapper">
                <div className="auto-group">
                    {/* header labels removed per design: logo moved into theme group */}
                  <label className="auto-logout-field" style={{ position: 'relative' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      Auto logout after idle (minutes)
                      <button type="button" title="Auto logout info" style={{ background: 'transparent', border: 'none', padding: 0, margin: 0 }} onClick={() => setShowInfo(true)}>
                        <FaInfoCircle aria-hidden style={{ color: '#9fbfb3' }} />
                      </button>
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={generalForm.autoLogoutMinutes ?? 0}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setGeneralForm({ ...generalForm, autoLogoutMinutes: Number.isNaN(v) ? 0 : v });
                      }}
                    />
                    <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>0 = disabled. Logs out the user after the configured minutes of inactivity.</small>
                  </label>
                  <label className="show-tooltips-field full chk">
                    <input type="checkbox" checked={!!generalForm.showTooltips} onChange={(e) => setGeneralForm({ ...generalForm, showTooltips: e.target.checked })} />
                    <span>Show Tooltips</span>
                  </label>
                </div>
              </div>
              
              {/* Financial / Pricing group */}
              <div className="financial-group" style={{ marginTop: '1rem', borderTop: '1px dashed rgba(255,255,255,0.04)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Financial</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <label>
                    <span>Price (Mini)</span>
                    <input type="number" min="0" step="0.01" value={generalForm.price_mini} onChange={(e) => setGeneralForm({ ...generalForm, price_mini: Number(e.target.value) })} />
                  </label>

                  <label>
                    <span>Price (Basic)</span>
                    <input type="number" min="0" step="0.01" value={generalForm.price_basic} onChange={(e) => setGeneralForm({ ...generalForm, price_basic: Number(e.target.value) })} />
                  </label>

                  <label>
                    <span>Price (Unlimited)</span>
                    <input type="number" min="0" step="0.01" value={generalForm.price_unlimited} onChange={(e) => setGeneralForm({ ...generalForm, price_unlimited: Number(e.target.value) })} />
                  </label>

                  <label>
                    <span>Currency</span>
                    <input type="text" value={generalForm.currency} onChange={(e) => setGeneralForm({ ...generalForm, currency: e.target.value })} placeholder="USD" />
                  </label>
                </div>
              </div>

              <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} title="Auto logout info">
                <p>Set the number of idle minutes after which the client will automatically log the user out. Enter 0 to disable auto-logout.</p>
                <p>This is enforced client-side to improve usability. For higher security, the server also supports token invalidation (logout) which is triggered when you sign out.</p>
              </InfoModal>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => fetchSettings('general')} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
              <button className="btn" onClick={onTest} disabled={testing}><FaFlask /> Validate</button>
            </div>
          </div>
        )}

        {tab === 'database' && (
          <div role="tabpanel" id="panel-database" aria-labelledby="tab-database" className="tab-panel">
            <h3>Database Settings</h3>
            {dbStatus && (
              <div className="db-status">
                <div className="db-status-row"><strong>DB:</strong> <span>{dbStatus.database}</span></div>
                <div className="db-status-row"><strong>Host:</strong> <span>{dbStatus.host}</span></div>
                <div className="db-status-row"><strong>Tables:</strong> <span>{dbStatus.tables}</span></div>
                <div className="db-status-row"><strong>Admins:</strong> <span>{dbStatus.counts?.admins ?? '-'}</span></div>
                <div className="db-status-row"><strong>Servers:</strong> <span>{dbStatus.counts?.servers ?? '-'}</span></div>
                <div className="db-status-row"><strong>Version:</strong> <span>{dbStatus.version || '—'}</span></div>
                <div className="db-status-row"><strong>DB Size:</strong> <span>{dbStatus.dbSize?.pretty || '—'}</span></div>
                <div className="db-status-row"><strong>Last Backup:</strong> <span>{dbStatus.lastBackup || '—'}</span></div>
              </div>
            )}
            {dbStatus?.largestTables?.length ? (
              <div className="db-status largest">
                {dbStatus.largestTables.map((t) => (
                  <div key={t.table} className="db-status-row"><strong>{t.table}:</strong> <span>{t.pretty}</span></div>
                ))}
              </div>
            ) : null}
            <div className="form-grid">
              <label>
                <span>Host</span>
                <input type="text" value={dbForm.host} onChange={(e) => setDbForm({ ...dbForm, host: e.target.value })} />
              </label>
              <label>
                <span>Port</span>
                <input type="number" min="1" max="65535" value={dbForm.port} onChange={(e) => setDbForm({ ...dbForm, port: Number(e.target.value) })} />
              </label>
              <label>
                <span>User</span>
                <input type="text" value={dbForm.user} onChange={(e) => setDbForm({ ...dbForm, user: e.target.value })} />
              </label>
              <label>
                <span>Password</span>
                <input type="password" value={dbForm.password} placeholder="••••••••" onChange={(e) => setDbForm({ ...dbForm, password: e.target.value })} />
              </label>
              <label className="full">
                <span>Database</span>
                <input type="text" value={dbForm.database} onChange={(e) => setDbForm({ ...dbForm, database: e.target.value })} />
              </label>
              <label className="full chk">
                <input type="checkbox" checked={!!dbForm.ssl} onChange={(e) => setDbForm({ ...dbForm, ssl: e.target.checked })} />
                <span>Use SSL</span>
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => fetchSettings('database')} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
              <button className="btn" onClick={onTest} disabled={testing}><FaFlask /> Test Connection</button>
            </div>

            <hr style={{ margin: '1rem 0', borderColor: 'rgba(255,255,255,0.08)' }} />
            <h4>Backup & Restore</h4>
            <div className="actions">
              <button className="btn" disabled={busy} onClick={() => download(backendOrigin + '/api/admin/backup/config?record=1', 'config.json')}><FaCloudDownloadAlt /> Download config.json</button>
              <button className="btn" disabled={busy} onClick={() => download(backendOrigin + '/api/admin/backup/db?record=1', 'database.db')}><FaCloudDownloadAlt /> Download database.db</button>
              <button className="btn primary" disabled={busy} onClick={async () => {
                try {
                  setBusy(true);
                  await axios.post(backendOrigin + '/api/admin/backup/record', {}, { headers: { ...authHeaders } });
                  // refresh status to show latest timestamp
                  try {
                    const rs = await axios.get(backendOrigin + '/api/admin/db/status', { headers: authHeaders });
                    setDbStatus(rs.data);
                  } catch (_) {}
                  showMsg('Backup Now recorded');
                } catch (err) {
                  showMsg('Backup Now failed: ' + (err.response?.data?.msg || err.message));
                } finally { setBusy(false); }
              }}>Backup Now</button>
            </div>
            <div className="form-grid" style={{ marginTop: '0.5rem' }}>
              <label className="full">
                <span>Restore Config (config.json)</span>
                <input type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(backendOrigin + '/api/admin/restore/config', f); e.target.value = ''; }} />
              </label>
              <label className="full">
                <span>Restore Database (.db)</span>
                <input type="file" accept=".db" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(backendOrigin + '/api/admin/restore/db', f); e.target.value = ''; }} />
              </label>
            </div>
          </div>
        )}

        {tab === 'telegram' && (
          <div role="tabpanel" id="panel-telegram" aria-labelledby="tab-telegram" className="tab-panel">
            <h3>Telegram Bot Settings</h3>
            <div className="form-grid">
              <label className="full">
                <span>Bot Token</span>
                <input type="password" value={tgForm.botToken} placeholder="123456:ABCDEF..." onChange={(e) => setTgForm({ ...tgForm, botToken: e.target.value })} />
              </label>
              <label>
                <span>Default Chat ID</span>
                <input type="text" value={tgForm.defaultChatId} onChange={(e) => setTgForm({ ...tgForm, defaultChatId: e.target.value })} />
              </label>
              <label className="full">
                <span>Message Template</span>
                <textarea rows={4} value={tgForm.messageTemplate} onChange={(e) => setTgForm({ ...tgForm, messageTemplate: e.target.value })} />
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => fetchSettings('telegram')} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
              <button className="btn" onClick={onTest} disabled={testing}><FaFlask /> Test Token</button>
            </div>
          </div>
        )}

        {tab === 'remote' && (
          <div role="tabpanel" id="panel-remote" aria-labelledby="tab-remote" className="tab-panel">
            <h3>Remote Server Settings</h3>
            <div className="form-grid">
              <label>
                <span>Host</span>
                <input type="text" value={rsForm.host} onChange={(e) => setRsForm({ ...rsForm, host: e.target.value })} />
              </label>
              <label>
                <span>Port</span>
                <input type="number" min="1" max="65535" value={rsForm.port} onChange={(e) => setRsForm({ ...rsForm, port: Number(e.target.value) })} />
              </label>
              <label>
                <span>Username</span>
                <input type="text" value={rsForm.username} onChange={(e) => setRsForm({ ...rsForm, username: e.target.value })} />
              </label>
              <label>
                <span>Auth Method</span>
                <select value={rsForm.authMethod} onChange={(e) => setRsForm({ ...rsForm, authMethod: e.target.value })}>
                  <option value="password">Password</option>
                  <option value="key">SSH Key</option>
                </select>
              </label>
              {rsForm.authMethod === 'password' ? (
                <label className="full">
                  <span>Password</span>
                  <input type="password" value={rsForm.password} onChange={(e) => setRsForm({ ...rsForm, password: e.target.value })} />
                </label>
              ) : (
                <>
                  <label className="full">
                    <span>Private Key (PEM)</span>
                    <textarea rows={6} value={rsForm.privateKey} onChange={(e) => setRsForm({ ...rsForm, privateKey: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  </label>
                  <label>
                    <span>Passphrase (optional)</span>
                    <input type="password" value={rsForm.passphrase} onChange={(e) => setRsForm({ ...rsForm, passphrase: e.target.value })} />
                  </label>
                </>
              )}
            </div>
            <div className="actions">
              <button className="btn" onClick={() => fetchSettings('remoteServer')} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
              <button className="btn" onClick={onTest} disabled={testing}><FaFlask /> Test Connectivity</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
