import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import InfoModal from '../components/InfoModal.jsx';
import { FaInfoCircle, FaCog } from 'react-icons/fa';
import axios from 'axios';
import { useAuth } from '../context/AuthContext.jsx';
import { FaSave, FaFlask, FaSyncAlt, FaDatabase, FaRobot, FaServer, FaCloudDownloadAlt, FaEye, FaEyeSlash, FaPowerOff, FaClock, FaCalendarAlt, FaCheckCircle, FaExclamationTriangle, FaHistory, FaShieldAlt } from 'react-icons/fa';
import { MdTune } from 'react-icons/md';
import { getBackendOrigin } from '../lib/backendOrigin';

export default function SettingsPage() {
  const TOKEN_MASK = '********';
  // Persist last selected tab
  const initialTab = useMemo(() => {
    try {
      const raw = localStorage.getItem('settings.lastTab') || 'database';
      // migrate legacy 'remote' tab id to 'control'
      return raw === 'remote' ? 'control' : raw;
    } catch (_) { return 'database'; }
  }, []);
  const [tab, setTab] = useState(initialTab);
  useEffect(() => { try { localStorage.setItem('settings.lastTab', tab); } catch (_) {} }, [tab]);

  // auth and API base
  const { token } = useAuth();
  const backendOrigin = useMemo(() => getBackendOrigin(), []);
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  // form states
  const [dbForm, setDbForm] = useState({ host: '', port: 5432, user: '', password: '', database: '', ssl: false });
  const [generalForm, setGeneralForm] = useState({
    title: 'VChannel',
    theme: (() => { try { return localStorage.getItem('themeOverride') || 'system'; } catch (_) { return 'system'; } })(),
    showTooltips: true,
    logo_url: '',
    logo_url_2x: '',
    favicon_url: '',
    apple_touch_icon_url: '',
    autoLogoutMinutes: 0,
    // Financial / pricing
    price_mini: 0,
    price_basic: 0,
    price_unlimited: 0,
    currency: 'USD',
    timezone: 'auto',
  });
  const [logoPreview, setLogoPreview] = useState('');
  const [logoPreview2x, setLogoPreview2x] = useState('');
  const [faviconPreview, setFaviconPreview] = useState('');
  const [applePreview, setApplePreview] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [tgForm, setTgForm] = useState({ botToken: '', defaultChatId: '', messageTemplate: '', notificationTime: '@daily', databaseBackup: false, loginNotification: false, enabled: true, settings_reload_seconds: 60 });
  const [botStatus, setBotStatus] = useState(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [tgTokenMasked, setTgTokenMasked] = useState(false); // true when server returned masked token
  const [showTgToken, setShowTgToken] = useState(false);
  const [preserveTgPlainToken, setPreserveTgPlainToken] = useState(null); // temporarily preserve plaintext after save when user requested to view it
  const [showRevealModal, setShowRevealModal] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState('');

  const canToggleTgShow = useMemo(() => {
    // We can toggle to show plaintext when:
    // - user has entered a plaintext token (not the sentinel), or
    // - we are preserving a freshly-entered plaintext after save
    if (preserveTgPlainToken) return true;
    if (tgForm && tgForm.botToken && tgForm.botToken !== TOKEN_MASK) return true;
    return false;
  }, [preserveTgPlainToken, tgForm]);
  // Install cert modal states
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installLines, setInstallLines] = useState([]);
  const [installRunning, setInstallRunning] = useState(false);
  const [installDone, setInstallDone] = useState(null);
  const [installRedirectCountdown, setInstallRedirectCountdown] = useState(null);
  // Control Panel state (system/cert/update) — removed deprecated system & service port states
  const [certStatus, setCertStatus] = useState(null);
  const [certConfig, setCertConfig] = useState({ domain: '', email: '', api_token: '', challenge_type: 'dns-cloudflare' });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateSource, setUpdateSource] = useState('');
  const [cpBusy, setCpBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  // New: clean version/update state
  const [versionInfo, setVersionInfo] = useState(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [autoCheckUpdate, setAutoCheckUpdate] = useState(() => {
    try { return localStorage.getItem('update.autoCheck') === 'true'; } catch (_) { return false; }
  });
  const [autoCheckInterval, setAutoCheckInterval] = useState(() => {
    try { return parseInt(localStorage.getItem('update.autoCheckInterval') || '24', 10) || 24; } catch (_) { return 24; }
  });
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateLines, setUpdateLines] = useState([]);
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateDone, setUpdateDone] = useState(null); // {code, restarting}
  // Frontend dev server (Vite) port control — removed per request
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [dbStatus, setDbStatus] = useState(null);
  // Restore UI state
  const [restoreFileConfig, setRestoreFileConfig] = useState(null);
  const [restoreFileDB, setRestoreFileDB] = useState(null);
  const [restoreFileSnapshot, setRestoreFileSnapshot] = useState(null);
  const [restoreInProgress, setRestoreInProgress] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [restoreError, setRestoreError] = useState('');

  // helpers
  const showMsg = useCallback((msg) => { setStatusMsg(msg); setTimeout(() => setStatusMsg(''), 4000); }, []);
  const currentForm = tab === 'database' ? dbForm : tab === 'telegram' ? tgForm : generalForm;
  // setCurrentForm helper removed (unused after direct state setters)

  const fetchSettings = useCallback(async (which) => {
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
      title: (typeof data.title === 'string' && data.title.trim()) ? data.title : (prev.title || 'VChannel'),
      theme: data.theme || prev.theme || 'system',
      showTooltips: typeof data.showTooltips === 'boolean' ? data.showTooltips : (typeof prev.showTooltips === 'boolean' ? prev.showTooltips : true),
      logo_url: data.logo_url || prev.logo_url || '',
      logo_url_2x: data.logo_url_2x || prev.logo_url_2x || '',
  favicon_url: data.favicon_url || prev.favicon_url || '',
  apple_touch_icon_url: data.apple_touch_icon_url || prev.apple_touch_icon_url || '',
      autoLogoutMinutes: resolvedAuto,
  // pricing (server now stores integer cents as price_*_cents); convert to decimals for UI
  price_mini: (typeof data.price_mini_cents !== 'undefined' && data.price_mini_cents !== null) ? Number(data.price_mini_cents) / 100 : ((typeof data.price_mini !== 'undefined' && data.price_mini !== null) ? Number(data.price_mini) : (prev.price_mini || 0)),
  price_basic: (typeof data.price_basic_cents !== 'undefined' && data.price_basic_cents !== null) ? Number(data.price_basic_cents) / 100 : ((typeof data.price_basic !== 'undefined' && data.price_basic !== null) ? Number(data.price_basic) : (prev.price_basic || 0)),
  price_unlimited: (typeof data.price_unlimited_cents !== 'undefined' && data.price_unlimited_cents !== null) ? Number(data.price_unlimited_cents) / 100 : ((typeof data.price_unlimited !== 'undefined' && data.price_unlimited !== null) ? Number(data.price_unlimited) : (prev.price_unlimited || 0)),
    currency: data.currency || prev.currency || 'USD',
    timezone: (typeof data.timezone !== 'undefined' && data.timezone !== null) ? data.timezone : (prev.timezone || 'auto'),
    };
  });
      // ensure client formatting sees the server value immediately
      if (key === 'general') {
        try { const tz = ((res && res.data && res.data.data) ? res.data.data.timezone : undefined); if (typeof tz !== 'undefined') { localStorage.setItem('app.timezone', tz === null ? 'auto' : String(tz)); } } catch (_) {}
      }
  if (key === 'telegram') {
        // Server masks botToken when returning; if masked we don't have the raw token and must preserve it on save
        const returnedToken = data.botToken;
        const isMasked = returnedToken === TOKEN_MASK;
        setTgTokenMasked(isMasked);
        // If we asked to preserve a plaintext token (user just saved and had the eye open), keep showing it until we've reloaded once
        if (isMasked && preserveTgPlainToken) {
          setShowTgToken(true);
          setTgForm({
            botToken: preserveTgPlainToken,
            defaultChatId: data.defaultChatId || '',
            messageTemplate: data.messageTemplate || '',
            notificationTime: typeof data.notificationTime !== 'undefined' ? data.notificationTime : (data.notification_time || '@daily'),
            databaseBackup: typeof data.databaseBackup !== 'undefined' ? !!data.databaseBackup : !!data.database_backup,
            loginNotification: typeof data.loginNotification !== 'undefined' ? !!data.loginNotification : !!data.login_notification,
          });
          // clear the preservation flag after applying it
          setPreserveTgPlainToken(null);
        } else {
          setShowTgToken(false);
          setTgForm({
              botToken: isMasked ? TOKEN_MASK : (returnedToken || ''),
              defaultChatId: data.defaultChatId || '',
              messageTemplate: data.messageTemplate || '',
              notificationTime: typeof data.notificationTime !== 'undefined' ? data.notificationTime : (data.notification_time || '@daily'),
              databaseBackup: typeof data.databaseBackup !== 'undefined' ? !!data.databaseBackup : !!data.database_backup,
              loginNotification: typeof data.loginNotification !== 'undefined' ? !!data.loginNotification : !!data.login_notification,
              enabled: typeof data.enabled !== 'undefined' ? !!data.enabled : true,
              settings_reload_seconds: typeof data.settings_reload_seconds !== 'undefined' ? Number(data.settings_reload_seconds) : 60,
            });
        }
      }
      // remoteServer section removed
    } catch (err) {
      showMsg(`Failed to load ${key} settings: ` + (err.response?.data?.msg || err.message));
    } finally { setLoading(false); }
  }, [authHeaders, backendOrigin, tab, TOKEN_MASK, preserveTgPlainToken, showMsg]);

  const fetchBotStatus = useCallback(async () => {
    try {
      const res = await axios.get(backendOrigin + '/internal/bot/status');
      if (res && res.data && res.data.ok) {
        setBotStatus(res.data.status || null);
      } else {
        setBotStatus(null);
      }
    } catch (_) {
      setBotStatus(null);
    }
  }, [backendOrigin]);

  // --- Control Panel fetchers & actions ---
  // Removed system status & service port fetchers per request (legacy placeholders deleted)
  const fetchCert = useCallback(async () => {
    try {
      const res = await axios.get(backendOrigin + '/api/admin/control/cert/status', { headers: authHeaders });
      setCertStatus(res.data || null);
      // also load config
      try {
        const r2 = await axios.get(backendOrigin + '/api/admin/control/cert/config', { headers: authHeaders });
        if (r2 && r2.data && r2.data.config) setCertConfig(r2.data.config);
      } catch (_) {}
    } catch (e) {
      setCertStatus(null);
    }
  }, [authHeaders, backendOrigin]);
  // fetchControlPanel removed (unused)
  // dev port helpers removed
  const saveCertConfig = async () => {
    try {
      setCpBusy(true);
      // send api_token only if provided (avoid re-sending masked sentinel) — backend will ignore '********'
      const payload = { domain: certConfig.domain || '', email: certConfig.email || '', challenge_type: certConfig.challenge_type || 'dns-cloudflare' };
      if (certConfig.api_token) payload.api_token = certConfig.api_token;
      await axios.put(backendOrigin + '/api/admin/control/cert/config', payload, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
      showMsg('Certificate config saved');
      await fetchCert();
    } catch (e) {
      showMsg('Save failed: ' + (e.response?.data?.error || e.response?.data?.msg || e.message));
    } finally { setCpBusy(false); }
  };
  const issueCert = async () => {
    try { setCpBusy(true); await axios.post(backendOrigin + '/api/admin/control/cert/issue', {}, { headers: authHeaders }); showMsg('Issue requested'); await fetchCert(); } catch (e) { showMsg('Issue failed: ' + (e.response?.data?.error || e.message)); } finally { setCpBusy(false); }
  };
  const renewCert = async () => {
    try { setCpBusy(true); await axios.post(backendOrigin + '/api/admin/control/cert/renew', {}, { headers: authHeaders }); showMsg('Renew requested'); await fetchCert(); } catch (e) { showMsg('Renew failed: ' + (e.response?.data?.error || e.message)); } finally { setCpBusy(false); }
  };
  const checkUpdate = async () => {
    try { setUpdateBusy(true); const res = await axios.get(backendOrigin + '/api/admin/control/update/check', { headers: authHeaders }); setUpdateInfo(res.data || null); showMsg('Update check complete');
      // load origin url too
      try {
        const r2 = await axios.get(backendOrigin + '/api/admin/control/update/source', { headers: authHeaders });
        setUpdateSource(r2.data?.originUrl || '');
      } catch (_) {}
      // and fetch status (git vs stored origin)
      try {
        const r3 = await axios.get(backendOrigin + '/api/admin/control/update/status', { headers: authHeaders });
        setUpdateStatus(r3.data || null);
      } catch (_) {}
    } catch (e) { showMsg('Check failed: ' + (e.response?.data?.error || e.message)); } finally { setUpdateBusy(false); }
  };
  const applyUpdate = async () => {
    try { setUpdateBusy(true); const res = await axios.post(backendOrigin + '/api/admin/control/update/apply', {}, { headers: authHeaders }); showMsg('Update apply requested'); if (res.data) setUpdateInfo(prev => ({ ...(prev||{}), applying: true })); } catch (e) { showMsg('Apply failed: ' + (e.response?.data?.error || e.message)); } finally { setUpdateBusy(false); }
  };
  const saveUpdateSource = async () => {
    try {
      setUpdateBusy(true);
      const resp = await axios.put(
        backendOrigin + '/api/admin/control/update/source',
        { url: updateSource },
        { headers: { ...authHeaders, 'Content-Type': 'application/json' }, validateStatus: () => true }
      );
      if (resp.status === 207) {
        const reason = resp.data && (resp.data.gitError || resp.data.error) ? ` (${resp.data.gitError || resp.data.error})` : '';
        showMsg('Saved source, but updating git remote failed' + reason);
      } else if (resp.status >= 200 && resp.status < 300) {
        showMsg('Update source saved');
      } else {
        throw new Error(resp.data && (resp.data.error || resp.data.msg) ? resp.data.error || resp.data.msg : `HTTP ${resp.status}`);
      }
      await checkUpdate();
    } catch (e) { showMsg('Save failed: ' + (e.response?.data?.error || e.message)); } finally { setUpdateBusy(false); }
  };

  const fetchUpdateStatus = useCallback(async () => {
    try {
      const r = await axios.get(backendOrigin + '/api/admin/control/update/status', { headers: authHeaders });
      setUpdateStatus(r.data || null);
    } catch (_) {
      setUpdateStatus(null);
    }
  }, [authHeaders, backendOrigin]);

  const loadUpdateLight = useCallback(async () => {
    // Lightweight load for Control tab: source + status (omit full check)
    try {
      const [s1, s2] = await Promise.all([
        axios.get(backendOrigin + '/api/admin/control/update/source', { headers: authHeaders }).catch(() => null),
        axios.get(backendOrigin + '/api/admin/control/update/status', { headers: authHeaders }).catch(() => null),
      ]);
      if (s1 && s1.data) setUpdateSource(s1.data.originUrl || '');
      if (s2 && s2.data) setUpdateStatus(s2.data);
    } catch (_) { /* ignore */ }
  }, [authHeaders, backendOrigin]);

  const retryUpdateOrigin = async () => {
    try {
      setUpdateBusy(true);
      const url = updateStatus?.storedOrigin || updateSource || '';
      if (!url) { showMsg('No stored origin URL to retry'); return; }
      const resp = await axios.put(
        backendOrigin + '/api/admin/control/update/source',
        { url },
        { headers: { ...authHeaders, 'Content-Type': 'application/json' }, validateStatus: () => true }
      );
      if (resp.status === 207) {
        const reason = resp.data && (resp.data.gitError || resp.data.error) ? ` (${resp.data.gitError || resp.data.error})` : '';
        showMsg('Saved source, but updating git remote failed' + reason);
      } else if (resp.status >= 200 && resp.status < 300) {
        showMsg('Git remote updated');
      } else {
        throw new Error(resp.data && (resp.data.error || resp.data.msg) ? resp.data.error || resp.data.msg : `HTTP ${resp.status}`);
      }
      await fetchUpdateStatus();
    } catch (e) { showMsg('Retry failed: ' + (e.response?.data?.error || e.message)); } finally { setUpdateBusy(false); }
  };

  // ── New clean version check ──
  const checkVersionInfo = useCallback(async () => {
    setVersionChecking(true);
    try {
      const res = await axios.get(backendOrigin + '/api/admin/control/update/version', { headers: authHeaders });
      setVersionInfo(res.data || null);
    } catch (_) {
      setVersionInfo(null);
    } finally {
      setVersionChecking(false);
    }
  }, [backendOrigin, authHeaders]);

  // ── Run the unattended update (SSE streaming) ──
  const runUpdate = async () => {
    setUpdateLines([]);
    setUpdateDone(null);
    setUpdateRunning(true);
    setShowUpdateModal(true);
    try {
      const res = await fetch(backendOrigin + '/api/admin/control/update/run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'done') {
              setUpdateDone({ code: msg.code, restarting: msg.restarting });
            } else {
              setUpdateLines(prev => [...prev, { type: msg.type, text: msg.text || '' }]);
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      setUpdateLines(prev => [...prev, { type: 'error', text: `Connection error: ${err.message}` }]);
      setUpdateDone({ code: -1, restarting: false });
    } finally {
      setUpdateRunning(false);
    }
  };

  // ── Install/configure domain: save config + certbot + nginx (SSE streaming) ──
  const installDomain = async () => {
    setInstallLines([]);
    setInstallDone(null);
    setInstallRunning(true);
    setShowInstallModal(true);
    try {
      const payload = { domain: certConfig.domain, email: certConfig.email, challenge_type: certConfig.challenge_type || 'dns-cloudflare' };
      if (certConfig.api_token && certConfig.api_token !== '********') payload.api_token = certConfig.api_token;
      const res = await fetch(backendOrigin + '/api/admin/control/cert/install', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'done') {
              setInstallDone({ code: msg.code });
              if (msg.code === 0) {
                await fetchCert();
                const targetDomain = certConfig.domain;
                if (targetDomain) {
                  let count = 5;
                  setInstallRedirectCountdown(count);
                  const timer = setInterval(() => {
                    count--;
                    setInstallRedirectCountdown(count);
                    if (count <= 0) { clearInterval(timer); window.location.href = `https://${targetDomain}`; }
                  }, 1000);
                }
              }
            } else {
              setInstallLines(prev => [...prev, { type: msg.type, text: msg.text || '' }]);
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      setInstallLines(prev => [...prev, { type: 'error', text: `Connection error: ${err.message}` }]);
      setInstallDone({ code: -1 });
    } finally {
      setInstallRunning(false);
    }
  };

  // load all on mount so switching tabs is instant
  useEffect(() => { fetchSettings('database'); fetchSettings('telegram'); fetchSettings('general'); fetchBotStatus(); fetchCert(); }, [fetchSettings, fetchBotStatus, fetchCert]);
  // When switching to Control tab, load version info + lightweight update status
  useEffect(() => { if (tab === 'control') { loadUpdateLight(); checkVersionInfo(); } }, [tab, loadUpdateLight, checkVersionInfo]);
  // Auto-check update interval
  useEffect(() => {
    if (!autoCheckUpdate) return;
    const ms = Math.max(1, autoCheckInterval) * 60 * 60 * 1000;
    const id = setInterval(() => { checkVersionInfo(); }, ms);
    return () => clearInterval(id);
  }, [autoCheckUpdate, autoCheckInterval, checkVersionInfo]);
  // Persist auto-check prefs
  useEffect(() => {
    try { localStorage.setItem('update.autoCheck', autoCheckUpdate ? 'true' : 'false'); } catch (_) {}
  }, [autoCheckUpdate]);
  useEffect(() => {
    try { localStorage.setItem('update.autoCheckInterval', String(autoCheckInterval)); } catch (_) {}
  }, [autoCheckInterval]);
  // Update current date/time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDateTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  // removed audit auto-refresh
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
      const key = tab === 'database' ? 'database' : tab === 'telegram' ? 'telegram' : 'general';
      const payload = currentForm;
      // Optimistically persist autoLogoutMinutes and broadcast so running clients pick it up immediately
      if (key === 'general') {
        if (typeof payload.autoLogoutMinutes !== 'undefined') {
          try { localStorage.setItem('autoLogoutMinutes', String(Number.isNaN(Number(payload.autoLogoutMinutes)) ? 0 : Number(payload.autoLogoutMinutes))); } catch (_) {}
        }
        // Immediately sync theme so changes are visible without page reload
        if (payload.theme === 'dark' || payload.theme === 'light' || payload.theme === 'system') {
          try { localStorage.setItem('themeOverride', payload.theme); } catch (_) {}
        }
        try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
      }
      // Ensure cents fields are included to be explicit and avoid accidental loss
  let sendPayload = { ...payload };
      if (key === 'general') {
        const asNumber = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 };
        try {
          if (typeof sendPayload.price_mini !== 'undefined') sendPayload.price_mini_cents = Math.round(asNumber(sendPayload.price_mini) * 100);
          if (typeof sendPayload.price_basic !== 'undefined') sendPayload.price_basic_cents = Math.round(asNumber(sendPayload.price_basic) * 100);
          if (typeof sendPayload.price_unlimited !== 'undefined') sendPayload.price_unlimited_cents = Math.round(asNumber(sendPayload.price_unlimited) * 100);
        } catch (_) {}
      }
      // timezone: allow explicit 'auto' or IANA tz string
      if (key === 'general') {
        if (typeof sendPayload.timezone !== 'undefined') {
          // nothing to convert here; send 'auto' as-is or tz string
        }
      }
      // If telegram token was masked on fetch and user didn't provide a new token, omit botToken so server preserves existing secret
      if (key === 'telegram') {
        const copy = { ...sendPayload };
        // If the token was masked when fetched and the user didn't provide a new token (or the masked sentinel),
        // omit botToken so the server preserves the existing secret.
        if (tgTokenMasked && (!copy.botToken || copy.botToken === '' || copy.botToken === TOKEN_MASK)) delete copy.botToken;
        // Also guard against the (unlikely) case where the form contains the sentinel without tgTokenMasked set
        if (!tgTokenMasked && copy.botToken === TOKEN_MASK) delete copy.botToken;
        sendPayload = copy;
      }

      const putRes = await axios.put(backendOrigin + `/api/admin/settings/${key}`, sendPayload, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
      showMsg('Saved successfully');
      // keep token display stable: if telegram, ensure we show masked token immediately
      if (key === 'telegram') {
        try {
          const hadNewToken = tgForm.botToken && tgForm.botToken !== TOKEN_MASK;
          const wasShowing = showTgToken;
          if (hadNewToken && wasShowing) {
            // user provided a new token and had requested to view it — preserve plaintext until fetch applies
            setPreserveTgPlainToken(tgForm.botToken);
            setTgTokenMasked(true);
            setShowTgToken(true);
            setTgForm(prev => ({ ...prev, botToken: tgForm.botToken }));
          } else {
            setTgTokenMasked(true);
            setShowTgToken(false);
            // keep the local form showing the masked sentinel until the server re-loads
            setTgForm(prev => ({ ...prev, botToken: TOKEN_MASK }));
          }
        } catch (_) {}
      }
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
        // persist timezone locally for immediate effect on client formatting
        try { if (typeof serverData.timezone !== 'undefined') { localStorage.setItem('app.timezone', serverData.timezone === null ? 'auto' : String(serverData.timezone)); } } catch (_) {}
      }
    } catch (err) {
      const errors = err.response?.data?.errors;
      showMsg('Save failed: ' + (errors ? errors.join(', ') : (err.response?.data?.msg || err.message)));
    } finally { setSaving(false); }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const key = tab === 'database' ? 'database' : tab === 'telegram' ? 'telegram' : 'general';
      let payload = { ...currentForm };
      // For telegram: omit masked sentinel so backend uses the stored token for testing
      if (key === 'telegram') {
        const copy = { ...payload };
        if (tgTokenMasked && (!copy.botToken || copy.botToken === TOKEN_MASK)) delete copy.botToken;
        if (!tgTokenMasked && copy.botToken === TOKEN_MASK) delete copy.botToken;
        payload = copy;
      }
      const res = await axios.post(backendOrigin + `/api/admin/settings/${key}/test`, payload, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
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

  const onClearFavicon = async () => {
    try {
      setBusy(true);
      await axios.delete(backendOrigin + '/api/admin/settings/general/favicon', { headers: authHeaders });
  setGeneralForm(g => ({ ...g, favicon_url: '', apple_touch_icon_url: '' }));
  setFaviconPreview('');
  setApplePreview('');
      showMsg('Favicon cleared');
  const payload = { ...generalForm, favicon_url: '', apple_touch_icon_url: '' };
      try { localStorage.setItem('general_refresh', String(Date.now())); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
    } catch (err) {
      showMsg('Clear favicon failed: ' + (err.response?.data?.msg || err.message));
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

  const startRestore = async (url, file) => {
    if (!file) return;
    setRestoreInProgress(true);
    setRestoreProgress(0);
    setRestoreMessage('');
    setRestoreError('');
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const config = { headers: { ...authHeaders } };
      // Only include onUploadProgress when the XHR upload API is available (some test envs lack it)
      try {
        const supportsXhrUpload = typeof window !== 'undefined' && window.XMLHttpRequest && window.XMLHttpRequest.prototype && window.XMLHttpRequest.prototype.upload && typeof window.XMLHttpRequest.prototype.upload.addEventListener === 'function';
        if (supportsXhrUpload) {
          config.onUploadProgress = (ev) => {
            try {
              const pct = ev.total ? Math.round((ev.loaded / ev.total) * 100) : null;
              if (pct !== null) setRestoreProgress(pct);
            } catch (_) {}
          };
        }
      } catch (_) {}
      const res = await axios.post(url, form, config);
      const msg = res?.data?.msg || (res?.data ? JSON.stringify(res.data) : 'Restore completed');
      setRestoreMessage(String(msg));
      // show success then reload page after brief pause
      setTimeout(() => {
        try { window.location.reload(); } catch (_) {}
      }, 1600);
    } catch (err) {
      const errMsg = err.response?.data?.msg || err.response?.data?.error || err.message || 'Restore failed';
      setRestoreError(String(errMsg));
    } finally {
      setRestoreInProgress(false);
      setRestoreProgress(0);
      // clear selected file to allow re-select
      setTimeout(() => {
        setRestoreFileConfig(null); setRestoreFileDB(null); setRestoreFileSnapshot(null);
      }, 400);
    }
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

  const onFaviconChange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const form = new FormData();
      form.append('favicon', f, f.name);
      setBusy(true);
      const res = await axios.post(backendOrigin + '/api/admin/settings/general/favicon', form, { headers: authHeaders });
  const url = res.data?.url || '';
  const urlTouch = res.data?.url_touch || '';
  setGeneralForm(g => ({ ...g, favicon_url: res.data?.favicon_url || g.favicon_url, apple_touch_icon_url: res.data?.apple_touch_icon_url || g.apple_touch_icon_url }));
  setFaviconPreview(url);
  setApplePreview(urlTouch || '');
      showMsg('Favicon uploaded');
  const payload = { ...generalForm, favicon_url: res.data?.favicon_url || generalForm.favicon_url, apple_touch_icon_url: res.data?.apple_touch_icon_url || generalForm.apple_touch_icon_url };
      try { localStorage.setItem('general_refresh', String(Date.now())); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('general-settings-updated', { detail: payload })); } catch (_) {}
    } catch (err) {
      showMsg('Favicon upload failed: ' + (err.response?.data?.msg || err.message));
    } finally { setBusy(false); }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2><FaCog aria-hidden style={{ marginRight: 10, verticalAlign: 'middle' }} />Settings</h2>
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
          aria-selected={tab === 'control'}
          id="tab-control"
          aria-controls="panel-control"
          className={`tab-btn${tab === 'control' ? ' active' : ''}`}
          onClick={() => setTab('control')}
        >
          <FaServer aria-hidden className="tab-icon" />
          <span className="tab-text">Control Panel</span>
        </button>
      </div>

      <div className="settings-content">
        {statusMsg && <div className="settings-status" role="status" aria-live="polite">{statusMsg}</div>}

        {/* Restore progress modal (moved out of Telegram tab so it is global) */}
        {(restoreInProgress || restoreMessage || restoreError) && (
          <div role="dialog" aria-live="polite" aria-modal style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' }} onClick={() => { if (!restoreInProgress) { setRestoreMessage(''); setRestoreError(''); } }} />
            <div style={{ width: 520, maxWidth: '92%', background: 'var(--panel-bg, #0f1720)', borderRadius: 12, padding: '1rem', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', color: 'var(--text-color,#fff)', zIndex: 10000 }}>
              <h3 style={{ margin: '0 0 0.5rem 0' }}>{restoreInProgress ? 'Restoring…' : (restoreError ? 'Restore failed' : 'Restore complete')}</h3>
              <div style={{ marginBottom: '0.75rem' }}>
                {restoreInProgress ? (
                  <div>
                    <div style={{ height: 12, width: '100%', background: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${restoreProgress}%`, background: 'linear-gradient(90deg,#37b24d,#8ce99a)', transition: 'width .25s ease' }} />
                    </div>
                    <div style={{ marginTop: 8, fontSize: '0.9rem', opacity: 0.9 }}>{restoreProgress}% uploaded</div>
                  </div>
                ) : restoreMessage ? (
                  <div role="status" style={{ fontSize: '0.95rem' }}>{restoreMessage}</div>
                ) : restoreError ? (
                  <div role="alert" style={{ color: '#ffb4b4' }}>{restoreError}</div>
                ) : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                {!restoreInProgress && (
                  <button className="btn" onClick={() => { setRestoreMessage(''); setRestoreError(''); }}>Close</button>
                )}
              </div>
            </div>
          </div>
        )}

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
              <label className="logo-field">
                <span>Favicon (32x32)</span>
                <input type="file" accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,image/webp,image/jpeg" onChange={onFaviconChange} />
                <div className="logo-preview-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {(faviconPreview || generalForm.favicon_url) ? (
                      <img
                        src={faviconPreview || (backendOrigin + generalForm.favicon_url)}
                        alt="Favicon preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: 16, height: 16, borderRadius: '4px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }} />
                    )}
                  </div>
                  <small style={{ opacity: 0.85 }}>Optimized to 32x32 PNG for tab icon</small>
                  {(faviconPreview || generalForm.favicon_url) && (
                    <button type="button" className="btn" onClick={onClearFavicon} disabled={busy} style={{ marginLeft: '0.5rem' }}>
                      Clear Favicon
                    </button>
                  )}
                </div>
              </label>
              <label className="logo-field">
                <span>Apple Touch Icon (180x180)</span>
                <div className="logo-preview-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <div style={{ width: 60, height: 60, borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {(applePreview || generalForm.apple_touch_icon_url) ? (
                      <img
                        src={applePreview || (backendOrigin + generalForm.apple_touch_icon_url)}
                        alt="Apple Touch icon preview"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    ) : (
                      <div style={{ width: 28, height: 28, borderRadius: '6px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }} />
                    )}
                  </div>
                  <small style={{ opacity: 0.85 }}>Generated automatically from favicon upload</small>
                  {(applePreview || generalForm.apple_touch_icon_url) && (
                    <button type="button" className="btn" onClick={onClearFavicon} disabled={busy} style={{ marginLeft: '0.5rem' }}>
                      Clear Apple Icon
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

              <div className="timezone-group" style={{ marginTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0' }}>Time Zone</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.75rem' }}>
                  <label>
                    <span>Time zone (affects how dates/times are shown across the app)</span>
                    {/*
                      Dropdown shows common IANA zones but includes GMT offset in the label when
                      available (e.g. "GMT+08:00 (Asia/Hong_Kong)"). The option value remains the
                      IANA identifier so the backend validator still validates using Intl.
                    */}
                    <select value={generalForm.timezone} onChange={(e) => setGeneralForm({ ...generalForm, timezone: e.target.value })}>
                      <option value="auto">Auto (use browser local time)</option>
                      {(() => {
                        // Build a full list of available IANA time zones. Prefer Intl.supportedValuesOf('timeZone') when available.
                        const now = new Date();
                        let zones = [];
                        try {
                          if (typeof Intl.supportedValuesOf === 'function') {
                            zones = Intl.supportedValuesOf('timeZone');
                          }
                        } catch (e) {
                          zones = [];
                        }
                        // Fallback list if supportedValuesOf isn't available
                        if (!zones || !zones.length) {
                          zones = [
                            'UTC','Etc/GMT','Etc/GMT+12','Pacific/Pago_Pago','Pacific/Honolulu','America/Anchorage','America/Los_Angeles','America/Denver','America/Chicago','America/New_York','America/Sao_Paulo','Atlantic/Azores','Europe/London','Europe/Dublin','Europe/Lisbon','Europe/Paris','Europe/Berlin','Europe/Warsaw','Africa/Cairo','Europe/Athens','Europe/Moscow','Asia/Dubai','Asia/Karachi','Asia/Kolkata','Asia/Dhaka','Asia/Yangon','Asia/Colombo','Asia/Jakarta','Asia/Bangkok','Asia/Shanghai','Asia/Ho_Chi_Minh','Asia/Singapore','Asia/Tokyo','Asia/Seoul','Australia/Perth','Australia/Adelaide','Australia/Sydney','Pacific/Auckland'
                          ];
                        }

                        // Map to objects with a human label containing GMT offset when possible
                        const mapped = zones.map((tz) => {
                          let label = tz;
                          try {
                            const formatted = new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' }).format(now);
                            const m = formatted.match(/GMT[+-]?\d{1,2}(?::\d{2})?/i);
                            if (m) label = `${m[0]} (${tz})`;
                            else {
                              // try to extract an abbreviation if GMT not present
                              const abb = formatted.match(/\b[A-Z]{2,6}\b/);
                              if (abb) label = `${abb[0]} (${tz})`;
                            }
                          } catch (e) {
                            // leave label as tz
                          }
                          return { tz, label };
                        });

                        // Sort so GMT offsets (when present) group together; otherwise alphabetical
                        mapped.sort((a, b) => {
                          // prefer entries with GMT in label
                          const aHas = /GMT/.test(a.label) ? 0 : 1;
                          const bHas = /GMT/.test(b.label) ? 0 : 1;
                          if (aHas !== bHas) return aHas - bHas;
                          return a.label.localeCompare(b.label);
                        });

                        return mapped.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>);
                      })()}
                    </select>
                    <small style={{ display: 'block', marginTop: '0.5rem', color: '#666', fontSize: '0.85rem' }}>
                      ℹ️ Select an IANA timezone (e.g., Asia/Yangon for Myanmar). This affects Telegram bot scheduling and date/time calculations throughout the app. Changes require a backend restart to take effect.
                    </small>
                  </label>
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: 'rgba(0, 150, 255, 0.1)', borderRadius: '4px', border: '1px solid rgba(0, 150, 255, 0.3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <FaClock style={{ color: '#0096ff' }} />
                      <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>Current Time</span>
                    </div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '500', fontFamily: 'monospace', marginTop: '0.5rem' }}>
                      {(() => {
                        const tz = generalForm.timezone === 'auto' ? undefined : generalForm.timezone;
                        const dateOpts = { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric',
                          timeZone: tz
                        };
                        const timeOpts = {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                          hour12: false,
                          timeZone: tz
                        };
                        try {
                          const datePart = currentDateTime.toLocaleDateString(undefined, dateOpts);
                          const timePart = currentDateTime.toLocaleTimeString(undefined, timeOpts);
                          return `${datePart}, ${timePart}`;
                        } catch (e) {
                          return currentDateTime.toString();
                        }
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} title="Auto logout info">
                <p>Set the number of idle minutes after which the client will automatically log the user out. Enter 0 to disable auto-logout.</p>
                <p>This is enforced client-side to improve usability. For higher security, the server also supports token invalidation (logout) which is triggered when you sign out.</p>
              </InfoModal>

              {/* Reveal token modal (password confirmation) */}
              <InfoModal isOpen={showRevealModal} onClose={() => { setShowRevealModal(false); setRevealPassword(''); setRevealError(''); }} title="Reveal Telegram token">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p style={{ margin: 0 }}>Enter your admin password to reveal the Telegram bot token. This action will be recorded in the audit log and the token will be shown temporarily; it will remain masked in the settings listing and re-masked on reload or save.</p>
                  <input type="password" value={revealPassword} onChange={(e) => setRevealPassword(e.target.value)} placeholder="Admin password" style={{ padding: '0.5rem', marginTop: '0.25rem' }} />
                  {revealError && <div style={{ color: '#f66' }}>{revealError}</div>}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="btn" onClick={() => { setShowRevealModal(false); setRevealPassword(''); setRevealError(''); }} disabled={revealBusy}>Cancel</button>
                    <button aria-busy={revealBusy} className="btn primary" onClick={async () => {
                      try {
                        setRevealBusy(true);
                        setRevealError('');
                        const res = await axios.post(backendOrigin + '/api/admin/settings/telegram/reveal', { password: revealPassword }, { headers: { ...authHeaders, 'Content-Type': 'application/json' } });
                        const token = res && res.data ? res.data.botToken : null;
                        if (token) {
                          setPreserveTgPlainToken(token);
                          setTgForm(prev => ({ ...prev, botToken: token }));
                          setShowTgToken(true);
                          setTgTokenMasked(true);
                          setShowRevealModal(false);
                          setRevealPassword('');
                        } else {
                          setRevealError('Reveal succeeded but no token returned');
                        }
                      } catch (err) {
                        const msg = err.response?.data?.msg || err.response?.data?.error || err.message || 'Reveal failed';
                        setRevealError(String(msg));
                      } finally { setRevealBusy(false); }
                    }} disabled={revealBusy || !revealPassword}>
                      {revealBusy ? (<><FaSyncAlt className="spin" /> Revealing...</>) : (<><FaSave /> Reveal</>)}
                    </button>
                  </div>
                </div>
              </InfoModal>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => fetchSettings('general')} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
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
            <h4>Backup &amp; Restore</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem', fontWeight: 600, fontSize: '0.85rem' }}>
                  <FaCloudDownloadAlt style={{ opacity: 0.8 }} /> Backups
                  <FaInfoCircle title="Download your current data as backup files. config.json contains app settings; database.db is the full PostgreSQL dump; the Telegram snapshot is the same JSON the bot uses." style={{ opacity: 0.6, cursor: 'help', marginLeft: 'auto' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-start' }}>
                  <button className="btn" disabled={busy} onClick={() => download(backendOrigin + '/api/admin/backup/config?record=1', 'config.json')}><FaCloudDownloadAlt /> config.json</button>
                  <button className="btn" disabled={busy} onClick={() => download(backendOrigin + '/api/admin/backup/db?record=1', 'database.db')}><FaCloudDownloadAlt /> database.db</button>
                  <button className="btn" disabled={busy} onClick={() => download(backendOrigin + '/api/admin/backup/snapshot?record=1', 'cmp-backup.json')} title="Same JSON format as Telegram bot backup"><FaCloudDownloadAlt /> Telegram snapshot</button>
                  <button className="btn primary" disabled={busy} onClick={async () => {
                    try {
                      setBusy(true);
                      await axios.post(backendOrigin + '/api/admin/backup/record', {}, { headers: { ...authHeaders } });
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
              </div>
            </div>
            <div className="form-grid" style={{ marginTop: '0.5rem' }}>
              <label className="full">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                  <span>Restore Config (config.json)</span>
                  <FaInfoCircle title="Restore app settings from a previously downloaded config.json. The page will reload after restore." style={{ opacity: 0.6, cursor: 'help', fontSize: '0.9em' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input aria-label="Restore Config" type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) setRestoreFileConfig(f); e.target.value = ''; }} />
                  <button className="btn primary" disabled={!restoreFileConfig || restoreInProgress} onClick={() => startRestore(backendOrigin + '/api/admin/restore/config', restoreFileConfig)}>Restore</button>
                  {restoreFileConfig && <small style={{ opacity: 0.85 }}>{restoreFileConfig.name}</small>}
                </div>
              </label>
              <label className="full">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                  <span>Restore Database (.db)</span>
                  <FaInfoCircle title="Restore the full PostgreSQL database from a previously downloaded database.db dump. All existing data will be replaced. The page will reload after restore." style={{ opacity: 0.6, cursor: 'help', fontSize: '0.9em' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input aria-label="Restore Database" type="file" accept=".db" onChange={(e) => { const f = e.target.files?.[0]; if (f) setRestoreFileDB(f); e.target.value = ''; }} />
                  <button className="btn primary" disabled={!restoreFileDB || restoreInProgress} onClick={() => startRestore(backendOrigin + '/api/admin/restore/db', restoreFileDB)}>Restore</button>
                  {restoreFileDB && <small style={{ opacity: 0.85 }}>{restoreFileDB.name}</small>}
                </div>
              </label>
              <label className="full">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                  <span>Restore Telegram Snapshot (JSON)</span>
                  <FaInfoCircle title="Restore from a Telegram bot backup snapshot (JSON). This restores user/server data the bot exported. The page will reload after restore." style={{ opacity: 0.6, cursor: 'help', fontSize: '0.9em' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input aria-label="Restore Telegram Snapshot (JSON)" type="file" accept="application/json,.json" onChange={(e) => { const f = e.target.files?.[0]; if (f) setRestoreFileSnapshot(f); e.target.value = ''; }} />
                  <button className="btn primary" disabled={!restoreFileSnapshot || restoreInProgress} onClick={() => startRestore(backendOrigin + '/api/admin/restore/snapshot', restoreFileSnapshot)}>Restore</button>
                  {restoreFileSnapshot && <small style={{ opacity: 0.85 }}>{restoreFileSnapshot.name}</small>}
                </div>
              </label>
            </div>
          </div>
        )}

        {tab === 'telegram' && (
          <div role="tabpanel" id="panel-telegram" aria-labelledby="tab-telegram" className="tab-panel telegram-tab">
            <h3>Telegram Bot Settings</h3>
            {/* Scoped compact glossy toggle styles (theme-aware). Ensures consistent rendering regardless of global CSS order. */}
            <style>{`
              /* Ensure the toggle never stretches in flex/inline contexts */
              .settings-page .toy-toggle { position: relative; display: inline-block; width: var(--w,72px); height: var(--h,40px); min-width: var(--w,72px); max-width: var(--w,72px); min-height: var(--h,40px); max-height: var(--h,40px); border-radius: calc(var(--h,40px)/2); background: #f3f5f7; overflow: hidden; box-shadow: inset 0 6px 12px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.12); --rim: 2px; line-height: 0; box-sizing: border-box; flex: 0 0 auto; contain: strict; isolation: isolate; font-size: initial; --w: 66px; --h: 36px; --pad: 4px; }
              /* Make layer spans absolutely positioned and block-sized by default */
              .settings-page .toy-toggle > span { position: absolute; left: 0; top: 0; right: 0; bottom: 0; display: block; box-sizing: border-box; }
              /* Neutralize any global centering transforms applied elsewhere */
              .settings-page .toy-toggle > span:not(.handle) { transform: none !important; }
              /* Outer shell and bright rim layers */
              .settings-page .toy-toggle .border1 { inset: 0; border-radius: calc(var(--h,40px)/2); z-index: 0;
                background: linear-gradient(180deg, rgba(255,255,255,0.22), rgba(0,0,0,0.10));
                box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25), 0 1px 2px rgba(0,0,0,0.25);
              }
              .settings-page .toy-toggle .border2 { inset: var(--rim,2px); border-radius: calc(var(--h,40px)/2); z-index: 1; pointer-events: none;
                background: linear-gradient(180deg, #ffffff, #e8eef6);
                box-shadow: inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.16);
              }
              .settings-page .toy-toggle .border3 { inset: calc(var(--pad,4px) + var(--rim,2px)); border-radius: calc(var(--h,40px)/2); z-index: 2; background: linear-gradient(180deg,var(--off1,#dfe3e7),var(--off2,#c4c9d0)); box-shadow: inset 0 8px 14px rgba(0,0,0,0.32), inset 0 0 0 1px rgba(0,0,0,0.12); transition: background .25s ease; }
              /* Neutralize legacy global width/height set in ems for classic toggle */
              .settings-page .toy-toggle .border1,
              .settings-page .toy-toggle .border2,
              .settings-page .toy-toggle .border3 { width: auto !important; height: auto !important; }
              .settings-page .toy-toggle .handle { top: 50%; left: calc(var(--pad,4px) + var(--rim,2px)); width: calc(var(--h,40px) - 2*var(--pad,4px) - 2*var(--rim,2px)); height: calc(var(--h,40px) - 2*var(--pad,4px) - 2*var(--rim,2px)); transform: translateY(-50%); border-radius: 50%; z-index: 3;
                background: radial-gradient(circle at 35% 30%, #ffffff 0%, #f5f5f5 40%, #dddddd 70%, #c9c9c9 100%);
                box-shadow: inset 0 2px 5px rgba(255,255,255,0.9), inset 0 -6px 10px rgba(0,0,0,0.20), 0 4px 8px rgba(0,0,0,0.20);
                transition: left .28s cubic-bezier(.4,0,.2,1), background .25s ease; }
              .settings-page .toy-toggle .handle-off, .settings-page .toy-toggle .handle-on { display: none; }
              .settings-page .toy-toggle-input:checked + .toy-toggle .border3 { background: linear-gradient(180deg,var(--on1,#3aa04b),var(--on2,#58c46a)); }
              .settings-page .toy-toggle-input:checked + .toy-toggle .handle { left: calc(var(--w,72px) - (var(--pad,4px) + var(--rim,2px)) - (var(--h,40px) - 2*(var(--pad,4px) + var(--rim,2px)))); background: radial-gradient(circle at 35% 30%, #a6f08d 0%, #7fe474 50%, #6cd45f 100%); }
              /* Focus ring for keyboard navigation */
              .settings-page .toy-toggle-input:focus-visible + .toy-toggle { outline: 2px solid #7cc0ff; outline-offset: 2px; }
              /* Reduced motion preference */
              @media (prefers-reduced-motion: reduce) {
                .settings-page .toy-toggle .handle,
                .settings-page .toy-toggle .border3 { transition: none; }
              }
              /* Theme tuning */
              body.theme-dark .settings-page .toy-toggle { background: #1d2a36; box-shadow: inset 0 6px 14px rgba(0,0,0,0.55), 0 8px 16px rgba(0,0,0,0.3); }
              body.theme-dark .settings-page .toy-toggle { --off1: #2a3947; --off2: #1f2a35; --on1: #2e9d42; --on2: #4ec264; }
              body.theme-dark .settings-page .toy-toggle .border2 { background: linear-gradient(180deg, #ffffff, #eef3f8); box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 0 0 1px rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.28); }
              body.theme-light .settings-page .toy-toggle { --off1: #e4e8ee; --off2: #cfd5dd; --on1: #4caf50; --on2: #69d057; }
              /* Status row default: single-line desktop; wraps on mobile */
              .telegram-tab .bot-status-row { display: flex; align-items: center; gap: 0.75rem; flex-wrap: nowrap; overflow-x: auto; white-space: nowrap; }
              @media (max-width: 640px) {
                .telegram-tab .bot-status-row { flex-wrap: wrap; overflow-x: visible; white-space: normal; }
              }
              /* Responsive layout for Telegram tab */
              @media (max-width: 640px) {
                .telegram-tab .form-grid { display: grid; grid-template-columns: 1fr !important; gap: 0.75rem; }
                .telegram-tab .form-grid .full { grid-column: 1 / -1; }
                .telegram-tab .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
                .telegram-tab .actions .btn { width: 100%; justify-content: center; }
                .telegram-tab .toy-toggle-wrap { gap: 0.5rem; }
                .telegram-tab .bot-status-card { padding: 0.5rem; }
                .telegram-tab .bot-status-card .btn { padding: 0.25rem 0.5rem; }
                /* Slightly smaller toggle on narrow screens */
                .telegram-tab .toy-toggle { --w: 58px; --h: 32px; --pad: 4px; --rim: 2px; }
              }
            `}</style>
            {/* Bot Runtime Status */}
              <div className="bot-status-card" style={{
              margin: '0 0 0.75rem 0', padding: '0.5rem 0.75rem', borderRadius: '0.75rem',
              border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)'
            }}>
                <div className="bot-status-row">
                <span title="Enabled" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FaPowerOff style={{ fontSize: '0.95em', verticalAlign: 'middle', color: tgForm.enabled ? '#69d057' : '#9aa4ad' }} /> {tgForm.enabled ? 'On' : 'Off'}
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span title="Reload interval" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FaClock style={{ fontSize: '0.95em', verticalAlign: 'middle' }} /> {(tgForm.settings_reload_seconds ?? 60)}s
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span title="Schedule" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FaCalendarAlt style={{ fontSize: '0.95em', verticalAlign: 'middle' }} /> {tgForm.notificationTime || '—'}
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span title="Last success" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FaCheckCircle style={{ fontSize: '0.95em', verticalAlign: 'middle', color: botStatus?.last_success ? '#6bd36b' : '#9aa4ad' }} /> {botStatus?.last_success ? new Date(botStatus.last_success).toLocaleString() : '—'}
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span title="Last error" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: botStatus?.last_error ? '#e57373' : 'inherit' }}>
                  <FaExclamationTriangle style={{ fontSize: '0.95em', verticalAlign: 'middle', color: botStatus?.last_error ? '#e57373' : '#9aa4ad' }} /> {botStatus?.last_error || '—'}
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span title="Updated" style={{ opacity: 0.9, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <FaHistory style={{ fontSize: '0.95em', verticalAlign: 'middle' }} /> {botStatus?.updated_at ? new Date(botStatus.updated_at).toLocaleString() : '—'}
                </span>
                <div style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
                  <button
                    className="btn"
                    title="Refresh status"
                    onClick={async () => { try { setStatusRefreshing(true); await fetchBotStatus(); } finally { setStatusRefreshing(false); } }}
                    disabled={statusRefreshing}
                    style={{ padding: '0.25rem 0.5rem' }}
                  >
                    <FaSyncAlt className={statusRefreshing ? 'spin' : ''} />
                    <span style={{ marginLeft: '0.35rem' }}>{statusRefreshing ? 'Refreshing…' : 'Refresh'}</span>
                  </button>
                </div>
                
              </div>
            </div>
            <div className="form-grid">
              <label className="full" style={{ position: 'relative' }}>
                <span>Bot Token</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type={showTgToken ? 'text' : 'password'}
                    name="tg_bot_token"
                    autoComplete="new-password"
                    spellCheck={false}
                    // When showing plaintext but the form holds the masked sentinel, prefer the preserved plaintext if any,
                    // otherwise show an empty string (don't show the sentinel as literal text).
                    value={(() => {
                      if (showTgToken) {
                        if (tgForm.botToken === TOKEN_MASK) return preserveTgPlainToken || '';
                        return tgForm.botToken || '';
                      }
                      return (tgForm.botToken ? TOKEN_MASK : (tgTokenMasked ? TOKEN_MASK : ''));
                    })()}
                    placeholder="123456:ABCDEF..."
                    onChange={(e) => { setTgTokenMasked(false); setPreserveTgPlainToken(null); setTgForm({ ...tgForm, botToken: e.target.value }); }}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (canToggleTgShow) {
                        setShowTgToken(s => !s);
                        return;
                      }
                      // When no plaintext available, prompt admin to re-enter password to reveal token
                      if (tgTokenMasked) {
                        // open modal to ask for admin password rather than using window.prompt
                        setRevealPassword('');
                        setRevealError('');
                        setShowRevealModal(true);
                      }
                    }}
                    title={canToggleTgShow ? (showTgToken ? 'Hide token' : 'Show token') : (tgTokenMasked ? 'Reveal token (requires password)' : 'No token to show — paste a token to replace')}
                    className={`btn${!canToggleTgShow ? ' disabled' : ''}`}
                    style={{ padding: '0.25rem 0.5rem', opacity: canToggleTgShow ? 1 : (tgTokenMasked ? 0.9 : 0.5), cursor: canToggleTgShow ? 'pointer' : (tgTokenMasked ? 'pointer' : 'not-allowed') }}
                    disabled={!canToggleTgShow && !tgTokenMasked}
                  >
                    {showTgToken ? <FaEyeSlash /> : <FaEye />}
                  </button>
                  {(tgForm.botToken || tgTokenMasked) && (
                    <button
                      type="button"
                      className="btn"
                      title="Clear token"
                      onClick={() => {
                        setTgForm({ ...tgForm, botToken: '' });
                        setTgTokenMasked(false);
                        setPreserveTgPlainToken(null);
                        setShowTgToken(false);
                      }}
                      style={{ padding: '0.25rem 0.5rem' }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {tgTokenMasked && !canToggleTgShow ? (
                  <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>Token is stored securely and cannot be retrieved — paste a new token to replace it.</small>
                ) : (
                  <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>Tip: saved tokens are masked — paste a new token to replace the existing one.</small>
                )}
              </label>
              <label>
                <span>Default Chat ID</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="text" value={tgForm.defaultChatId} onChange={(e) => setTgForm({ ...tgForm, defaultChatId: e.target.value })} style={{ flex: 1 }} />
                  {tgForm.defaultChatId && <button type="button" className="btn" onClick={() => setTgForm({ ...tgForm, defaultChatId: '' })} title="Clear" style={{ padding: '0.25rem 0.5rem' }}>×</button>}
                </div>
              </label>
              <label>
                <span>Settings Reload Interval (seconds)</span>
                <input type="number" min="5" step="1" value={tgForm.settings_reload_seconds ?? 60} onChange={(e) => setTgForm({ ...tgForm, settings_reload_seconds: Number(e.target.value) })} />
                <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>How often the bot reloads settings. Minimum 5 seconds. Default 60 seconds.</small>
              </label>
              {/* Telegram Bot Enabled (Toy Toggle) */}
              <div className="full" style={{ marginTop: '0.5rem' }}>
                <span style={{ display: 'block', marginBottom: '0.5rem' }} id="tg-enabled-label">Telegram Bot Enabled</span>
                <div className="toy-toggle-wrap" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <input
                    className="toy-toggle-input"
                    type="checkbox"
                    id="tg-enabled-toggle"
                    name="tg-enabled-toggle"
                    aria-label="Telegram Bot Enabled"
                    style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
                    checked={!!tgForm.enabled}
                    onChange={(e) => setTgForm({ ...tgForm, enabled: e.target.checked })}
                  />
                  <label htmlFor="tg-enabled-toggle" className="toy-toggle" aria-hidden
                    style={{ display: 'inline-block', width: 'var(--w,72px)', height: 'var(--h,40px)', minWidth: 'var(--w,72px)', maxWidth: 'var(--w,72px)', minHeight: 'var(--h,40px)', maxHeight: 'var(--h,40px)', borderRadius: 'calc(var(--h,40px)/2)', cursor: 'pointer' }}>
                    <span className="border1"></span>
                    <span className="border2"></span>
                    <span className="border3"></span>
                    <span className="handle">
                      <span className="handle-off"></span>
                      <span className="handle-on"></span>
                    </span>
                  </label>
                </div>
                <small style={{ display: 'block', marginTop: '0.5rem', opacity: 0.85 }}>Turn the Telegram bot ON or OFF. When OFF, the bot will not poll Telegram nor send notifications or backups.</small>
              </div>
              <label className="full">
                <span>Notification Time</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="text" value={tgForm.notificationTime} placeholder="@daily" onChange={(e) => setTgForm({ ...tgForm, notificationTime: e.target.value })} style={{ flex: 1 }} />
                  {tgForm.notificationTime && <button type="button" className="btn" onClick={() => setTgForm({ ...tgForm, notificationTime: '' })} title="Clear" style={{ padding: '0.25rem 0.5rem' }}>×</button>}
                </div>
                <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>The Telegram bot notification time set for periodic reports. (use the crontab time format)</small>
              </label>

              <label className="full">
                <span>Message Template</span>
                <textarea
                  rows={5}
                  value={tgForm.messageTemplate || ''}
                  onChange={(e) => setTgForm({ ...tgForm, messageTemplate: e.target.value })}
                  placeholder="Leave empty to use the default template"
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                  {tgForm.messageTemplate && <button type="button" className="btn" onClick={() => setTgForm({ ...tgForm, messageTemplate: '' })} title="Clear template">Clear Template</button>}
                </div>
                <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>Custom Handlebars/Mustache-style template for bot reports. Leave empty to use the built-in default.</small>
              </label>

              <label className="full chk" style={{ marginTop: '0.5rem' }}>
                <input type="checkbox" checked={!!tgForm.databaseBackup} onChange={(e) => setTgForm({ ...tgForm, databaseBackup: e.target.checked })} />
                <span>Database Backup</span>
                <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>Send a database backup file with a report.</small>
              </label>

              <label className="full chk" style={{ marginTop: '0.5rem' }}>
                <input type="checkbox" checked={!!tgForm.loginNotification} onChange={(e) => setTgForm({ ...tgForm, loginNotification: e.target.checked })} />
                <span>Login Notification</span>
                <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>Get notified about the username, IP address, and time whenever someone attempts to log into your web panel.</small>
              </label>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => { fetchSettings('telegram'); fetchBotStatus(); }} disabled={loading}><FaSyncAlt /> Refresh</button>
              <button className="btn primary" onClick={onSave} disabled={saving}><FaSave /> Save</button>
              <button className="btn" onClick={onTest} disabled={testing}><FaFlask /> Test Token</button>
              <button className="btn" onClick={async () => { try { setBusy(true); await axios.post(backendOrigin + '/api/admin/settings/telegram/apply-now', {}, { headers: authHeaders }); await fetchBotStatus(); showMsg('Applied settings to bot'); } catch (err) { showMsg('Apply failed: ' + (err.response?.data?.msg || err.message)); } finally { setBusy(false); } }} disabled={busy}><FaSyncAlt /> Apply now</button>
            </div>
          </div>
        )}

        {tab === 'control' && (
          <div role="tabpanel" id="panel-control" aria-labelledby="tab-control" className="tab-panel">
            <h3>Control Panel</h3>
            {/* Top status bar */}
            <div className="cp-statusbar" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', padding: '0.5rem 0.75rem', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', marginBottom: '0.75rem', background: 'rgba(255,255,255,0.04)' }}>
              {/* Service status removed */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }} title="Certificate status">
                <FaShieldAlt />
                <span>Cert</span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span>{certStatus?.domain || certConfig?.domain || '—'}</span>
                <span aria-hidden style={{ opacity: 0.5 }}>•</span>
                <span>{(certStatus && certStatus.cert && (typeof certStatus.cert.daysRemaining === 'number')) ? `${certStatus.cert.daysRemaining}d left` : 'no cert'}</span>
              </div>
            </div>
            <div className="cp-sections" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* System Status section removed */}
              {/* Certificate */}
              <section className="cp-cert" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '0.75rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0' }}>Certificate</h4>
                {/* Current cert status */}
                {certStatus && certStatus.cert ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '0.5rem', marginBottom: '0.75rem', padding: '0.6rem', background: 'rgba(76,175,130,0.08)', borderRadius: '0.5rem', border: '1px solid rgba(76,175,130,0.2)' }}>
                    <div><strong>Domain</strong><br />{certStatus.domain}</div>
                    <div><strong>Issuer</strong><br />{certStatus.cert.issuer || '—'}</div>
                    <div><strong>Expires</strong><br />{certStatus.cert.notAfter || '—'}</div>
                    <div><strong>Days Left</strong><br /><span style={{ color: (certStatus.cert.daysRemaining ?? 0) > 14 ? '#4caf82' : '#f88' }}>{certStatus.cert.daysRemaining ?? '—'}</span></div>
                    <div><strong>Method</strong><br /><span style={{ opacity: 0.8 }}>{certConfig.challenge_type === 'http' ? 'HTTP-01' : 'DNS-01'}</span></div>
                  </div>
                ) : (
                  <div style={{ opacity: 0.7, marginBottom: '0.75rem', padding: '0.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '0.5rem' }}>
                    {certStatus ? 'No certificate found.' : 'No status yet.'}
                  </div>
                )}
                {/* Config form */}
                <div className="form-grid" style={{ marginBottom: '0.5rem' }}>
                  <label>
                    <span>Domain</span>
                    <input type="text" value={certConfig.domain} onChange={(e) => setCertConfig({ ...certConfig, domain: e.target.value })} />
                  </label>
                  <label>
                    <span>Email</span>
                    <input type="email" value={certConfig.email} onChange={(e) => setCertConfig({ ...certConfig, email: e.target.value })} />
                  </label>
                  <label className="full">
                    <span>Challenge Type</span>
                    <select value={certConfig.challenge_type || 'dns-cloudflare'} onChange={(e) => setCertConfig({ ...certConfig, challenge_type: e.target.value })}>
                      <option value="dns-cloudflare">DNS-01 via Cloudflare (recommended)</option>
                      <option value="http">HTTP-01 standalone (port 80 must be open)</option>
                    </select>
                  </label>
                  {(certConfig.challenge_type || 'dns-cloudflare') === 'dns-cloudflare' && (
                    <label className="full">
                      <span>Cloudflare API Token</span>
                      <input
                        type="password"
                        value={certConfig.api_token}
                        placeholder={certConfig.api_token ? '••••••••' : 'Enter Cloudflare API token'}
                        onChange={(e) => setCertConfig({ ...certConfig, api_token: e.target.value })}
                      />
                      <small style={{ display: 'block', marginTop: '0.25rem', opacity: 0.85 }}>
                        Required for DNS-01. Written to /root/.cloudflare.ini.
                      </small>
                    </label>
                  )}
                </div>
                <div className="actions" style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn" disabled={cpBusy || installRunning} onClick={fetchCert}><FaSyncAlt /> Refresh</button>
                  <button className="btn" disabled={cpBusy || installRunning} onClick={saveCertConfig}><FaSave /> Save Config</button>
                  <button className="btn primary" disabled={cpBusy || installRunning || !certConfig.domain || !certConfig.email} onClick={installDomain} title="Save config, issue certificate, and configure nginx">
                    <FaShieldAlt /> Save &amp; Install
                  </button>
                  <button className="btn" disabled={cpBusy || installRunning} onClick={renewCert}><FaSyncAlt /> Renew</button>
                </div>
              </section>
              {/* Update */}
              <section className="cp-update" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0.75rem', padding: '1rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FaCloudDownloadAlt /> Update
                </h4>

                {/* Version info grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginBottom: '0.2rem' }}>Current Version</div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', fontFamily: 'monospace' }}>{versionInfo?.current ?? '—'}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginBottom: '0.2rem' }}>Latest Version</div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', fontFamily: 'monospace' }}>{versionInfo?.latest ?? '—'}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginBottom: '0.2rem' }}>Last Updated</div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {versionInfo?.lastAppliedAt ? new Date(versionInfo.lastAppliedAt).toLocaleString() : '—'}
                    </div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.6, marginBottom: '0.2rem' }}>Status</div>
                    {versionInfo == null ? (
                      <div style={{ opacity: 0.5, fontSize: '0.85rem' }}>Not checked</div>
                    ) : versionInfo.isOutdated ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#ffb06b', fontWeight: 700 }}>
                        <FaExclamationTriangle /> Outdated
                      </div>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#4caf82', fontWeight: 700 }}>
                        <FaCheckCircle /> Up to Date
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions row */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                  <button className="btn" disabled={versionChecking} onClick={checkVersionInfo} title="Check GitHub for latest version">
                    <FaSyncAlt style={versionChecking ? { animation: 'spin 1s linear infinite' } : {}} /> Check for Update
                  </button>
                  {versionInfo?.isOutdated && (
                    <button
                      className="btn primary"
                      disabled={updateRunning}
                      onClick={runUpdate}
                      style={{ background: 'rgba(0,191,165,0.8)', borderColor: '#00bfa5', color: '#fff' }}
                    >
                      <FaCloudDownloadAlt /> Update
                    </button>
                  )}
                </div>

                {/* Auto-check row */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none' }}>
                  <input
                    type="checkbox"
                    checked={autoCheckUpdate}
                    onChange={e => setAutoCheckUpdate(e.target.checked)}
                    style={{ width: 15, height: 15 }}
                  />
                  Auto check for updates every
                  <input
                    type="number"
                    min="1"
                    max="720"
                    value={autoCheckInterval}
                    onChange={e => setAutoCheckInterval(Math.max(1, parseInt(e.target.value) || 24))}
                    disabled={!autoCheckUpdate}
                    style={{ width: 55, padding: '0.15rem 0.3rem', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'inherit', fontSize: '0.85rem', textAlign: 'center', opacity: autoCheckUpdate ? 1 : 0.4 }}
                  />
                  hours
                </label>
                {versionInfo?.checkedAt && (
                  <div style={{ fontSize: '0.72rem', opacity: 0.4, marginTop: '0.4rem' }}>
                    Last checked: {new Date(versionInfo.checkedAt).toLocaleString()}
                  </div>
                )}
              </section>

              {/* Update Progress Modal */}
              {showUpdateModal && (
                <div style={{
                  position: 'fixed', inset: 0, zIndex: 9999,
                  background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                }}>
                  <div style={{
                    background: '#1a2433', border: '1px solid rgba(0,191,165,0.25)', borderRadius: '12px',
                    width: '100%', maxWidth: '680px', display: 'flex', flexDirection: 'column', maxHeight: '80vh'
                  }}>
                    <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <FaCloudDownloadAlt style={{ color: '#00bfa5' }} />
                      <strong style={{ flex: 1 }}>Updating…</strong>
                      {!updateRunning && (
                        <button
                          onClick={() => { setShowUpdateModal(false); if (updateDone?.restarting) showMsg('Service is restarting — please refresh in a moment'); }}
                          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.1rem' }}
                        >✕</button>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', position: 'relative', overflow: 'hidden' }}>
                      {updateRunning && (
                        <div style={{
                          height: '100%', width: '30%', background: '#00bfa5',
                          animation: 'progressSlide 1.5s ease-in-out infinite',
                          position: 'absolute'
                        }} />
                      )}
                      {!updateRunning && updateDone?.code === 0 && (
                        <div style={{ height: '100%', width: '100%', background: '#4caf82', transition: 'width 0.4s' }} />
                      )}
                      {!updateRunning && updateDone?.code !== 0 && updateDone != null && (
                        <div style={{ height: '100%', width: '100%', background: '#e05555' }} />
                      )}
                    </div>

                    {/* Log output */}
                    <div style={{
                      flex: 1, overflowY: 'auto', padding: '0.75rem 1rem',
                      fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6,
                      background: '#111820', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                    }} ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
                      {updateLines.map((l, i) => (
                        <span key={i} style={{ color: l.type === 'error' || l.type === 'err' ? '#f88' : l.type === 'restarting' ? '#ffb06b' : '#c8fff4' }}>
                          {l.text}
                        </span>
                      ))}
                      {updateRunning && <span style={{ opacity: 0.5 }}>▌</span>}
                    </div>

                    {/* Footer */}
                    {!updateRunning && updateDone != null && (
                      <div style={{ padding: '0.75rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {updateDone.code === 0 ? (
                          <>
                            <FaCheckCircle style={{ color: '#4caf82' }} />
                            <span style={{ color: '#4caf82', flex: 1 }}>
                              {updateDone.restarting ? 'Update complete — service is restarting. Please refresh the page.' : 'Update complete!'}
                            </span>
                          </>
                        ) : (
                          <>
                            <FaExclamationTriangle style={{ color: '#f88' }} />
                            <span style={{ color: '#f88', flex: 1 }}>Update failed (exit code {updateDone.code}). Check output above.</span>
                          </>
                        )}
                        <button
                          className="btn"
                          onClick={() => { setShowUpdateModal(false); checkVersionInfo(); }}
                        >Close</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Install Domain Progress Modal */}
              {showInstallModal && (
                <div style={{
                  position: 'fixed', inset: 0, zIndex: 9999,
                  background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
                }}>
                  <div style={{
                    background: '#1a2433', border: '1px solid rgba(0,191,165,0.25)', borderRadius: '12px',
                    width: '100%', maxWidth: '680px', display: 'flex', flexDirection: 'column', maxHeight: '80vh'
                  }}>
                    <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <FaShieldAlt style={{ color: '#00bfa5' }} />
                      <strong style={{ flex: 1 }}>Installing Domain: {certConfig.domain}</strong>
                      {!installRunning && (
                        <button
                          onClick={() => setShowInstallModal(false)}
                          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.1rem' }}
                        >✕</button>
                      )}
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', position: 'relative', overflow: 'hidden' }}>
                      {installRunning && (
                        <div style={{
                          height: '100%', width: '30%', background: '#00bfa5',
                          animation: 'progressSlide 1.5s ease-in-out infinite',
                          position: 'absolute'
                        }} />
                      )}
                      {!installRunning && installDone?.code === 0 && (
                        <div style={{ height: '100%', width: '100%', background: '#4caf82', transition: 'width 0.4s' }} />
                      )}
                      {!installRunning && installDone?.code !== 0 && installDone != null && (
                        <div style={{ height: '100%', width: '100%', background: '#e05555' }} />
                      )}
                    </div>
                    <div style={{
                      flex: 1, overflowY: 'auto', padding: '0.75rem 1rem',
                      fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6,
                      background: '#111820', whiteSpace: 'pre-wrap', wordBreak: 'break-all'
                    }} ref={el => { if (el) el.scrollTop = el.scrollHeight; }}>
                      {installLines.map((l, i) => (
                        <span key={i} style={{ display: 'block', color: l.type === 'error' ? '#f88' : l.type === 'warn' ? '#ffb06b' : '#c8fff4' }}>
                          {l.text}
                        </span>
                      ))}
                      {installRunning && <span style={{ opacity: 0.5 }}>▌</span>}
                    </div>
                    {!installRunning && installDone != null && (
                      <div style={{ padding: '0.75rem 1.1rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {installDone.code === 0 ? (
                          <><FaCheckCircle style={{ color: '#4caf82' }} />
                          <span style={{ color: '#4caf82', flex: 1 }}>
                            Installation complete for {certConfig.domain}!
                            {installRedirectCountdown != null && ` Redirecting to https://${certConfig.domain} in ${installRedirectCountdown}s…`}
                          </span></>
                        ) : (
                          <><FaExclamationTriangle style={{ color: '#f88' }} />
                          <span style={{ color: '#f88', flex: 1 }}>Installation failed (exit code {installDone.code}). Check output above.</span></>
                        )}
                        <button className="btn" onClick={() => setShowInstallModal(false)}>Close</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Restart confirm modal removed */}
      </div>
    </div>
  );
}

// (legacy helpers removed)
