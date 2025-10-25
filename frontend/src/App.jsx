import { Outlet, Link, NavLink } from 'react-router-dom';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import './App.css';
import { ToastProvider } from './context/ToastContext.jsx';
import { FaArrowUp } from 'react-icons/fa';
import AdminEditorForm from './components/AdminEditorForm';
import { FaUser, FaSignOutAlt, FaLeaf, FaMoon, FaSun, FaDesktop, FaCheck } from 'react-icons/fa';
import axios from 'axios';
import ConfirmModal from './components/ConfirmModal.jsx';
import IdleToast from './components/IdleToast.jsx';

function BackToTop() {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 200);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const goTop = () => {
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
  };
  return (
    <div aria-hidden className="back-to-top-wrap">
      {visible && (
        <button type="button" onClick={goTop} title="Back to top" className="back-to-top-btn">
          <FaArrowUp aria-hidden />
        </button>
      )}
    </div>
  );
}

function App() {
  // App title and theme from General settings
  const [appTitle, setAppTitle] = useState('YN Paradise Customer Management Portal');
  const [appTheme, setAppTheme] = useState('system'); // 'system' | 'dark' | 'light'

  // helper to apply theme to <body> respecting system preference
  useEffect(() => {
    const applyTheme = (preferred) => {
      const isSystemDark = (() => {
        try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; }
      })();
      const effective = preferred === 'system' ? (isSystemDark ? 'dark' : 'light') : preferred;
      if (effective === 'light') {
        document.body.classList.add('theme-light');
      } else {
        document.body.classList.remove('theme-light');
      }
    };
    applyTheme(appTheme);
    // react to system changes when in system mode
    let mm;
    if (appTheme === 'system') {
      try {
        mm = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => applyTheme('system');
        if (mm && mm.addEventListener) mm.addEventListener('change', listener);
        else if (mm && mm.addListener) mm.addListener(listener);
        return () => {
          if (mm && mm.removeEventListener) mm.removeEventListener('change', listener);
          else if (mm && mm.removeListener) mm.removeListener(listener);
        };
      } catch (_) { /* ignore */ }
    }
    return undefined;
  }, [appTheme]);

  // On mount, apply local theme override if present
  useEffect(() => {
    try {
      const override = localStorage.getItem('themeOverride');
      if (override === 'dark' || override === 'light' || override === 'system') {
        setAppTheme(override);
      }
    } catch (_) {}
  }, []);

  // Fetch General settings (public)
  useEffect(() => {
    const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
    const applyGeneral = (general) => {
      if (general && typeof general.title === 'string' && general.title.trim()) {
        setAppTitle(general.title);
        try { document.title = general.title; } catch (_) {}
      }
      if (general && general.theme) {
        try {
          const override = localStorage.getItem('themeOverride');
          if (override === 'dark' || override === 'light' || override === 'system') {
            setAppTheme(override);
          } else {
            setAppTheme(general.theme);
          }
        } catch (_) {
          setAppTheme(general.theme);
        }
      }
      // Persist auto-logout minutes when the public general settings include a non-null value
      try {
        if (general && general.autoLogoutMinutes != null) {
          const parsed = Number(general.autoLogoutMinutes);
          if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            try { localStorage.setItem('autoLogoutMinutes', String(parsed)); } catch (_) {}
          }
        }
      } catch (_) {}
      try {
        const el = document.querySelector('.main-logo');
        if (el) {
          const hasLogoField = general && (Object.prototype.hasOwnProperty.call(general, 'logo_url') || Object.prototype.hasOwnProperty.call(general, 'logo_url_2x'));
          if (hasLogoField) {
            // If event explicitly includes logo fields, update the header image accordingly
            el.setAttribute('data-has-logo', general && general.logo_url ? '1' : '0');
            el.setAttribute('data-logo-url', general && general.logo_url ? general.logo_url : '');
            const img = el.querySelector('.main-logo-img');
            if (img) {
              const origin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
              const url1x = general && general.logo_url ? (origin + general.logo_url) : '';
              const url2x = general && general.logo_url_2x ? (origin + general.logo_url_2x) : '';
              if (url1x) {
                img.src = url1x;
                if (url2x) img.srcset = `${url1x} 1x, ${url2x} 2x`; else img.removeAttribute('srcset');
              } else {
                // explicit clear
                img.removeAttribute('src');
                img.removeAttribute('srcset');
              }
            }
          } else {
            // No logo fields in payload: don't change existing logo. Optionally, you can trigger a refresh fetch here.
          }
        }
      } catch (_) {}
    };
    const fetchGeneral = async () => {
      try {
        const res = await fetch(backendOrigin + '/api/admin/public/settings/general');
        if (!res.ok) return;
        const data = await res.json();
        const general = data && data.data ? data.data : {};
        applyGeneral(general);
      } catch (_) { /* ignore */ }
    };
    // initial load
    fetchGeneral();
    // react to storage signal (cross-tab or same-tab)
    const onStorage = (e) => {
      try {
        if (e && e.key === 'general_refresh') {
          fetchGeneral();
        }
      } catch (_) {}
    };
    window.addEventListener('storage', onStorage);
    // react to in-app event with payload
    const onGeneralEvent = (e) => {
      try { applyGeneral(e && e.detail ? e.detail : null); } catch (_) {}
    };
    window.addEventListener('general-settings-updated', onGeneralEvent);
    // Listen for theme override changes from other tabs/windows
    const onStorageTheme = (e) => {
      try {
        if (e && e.key === 'themeOverride') {
          const val = e.newValue;
          if (val === 'dark' || val === 'light' || val === 'system') setAppTheme(val);
        }
      } catch (_) {}
    };
    window.addEventListener('storage', onStorageTheme);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('general-settings-updated', onGeneralEvent);
      window.removeEventListener('storage', onStorageTheme);
    };
  }, []);
  const { logout, user, token } = useAuth();
  // decoded token may include { user: {...} } or be the user object itself; normalize
  let profile = user && user.user ? user.user : user;
  // fall back to legacy localStorage('user') if present and profile is missing
  if (!profile) {
    try {
      const stored = localStorage.getItem('user');
      if (stored) profile = JSON.parse(stored);
    } catch (e) { /* ignore */ }
  }
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountProfile, setAccountProfile] = useState(null);
  // idle warning modal state
  const [idleWarning, setIdleWarning] = useState({ show: false, remainingMs: 0 });
  useEffect(() => {
    let countdownInterval = null;
    const handler = (e) => {
      const rem = e && e.detail && typeof e.detail.remainingMs === 'number' ? e.detail.remainingMs : 60000;
      setIdleWarning({ show: true, remainingMs: rem });
      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = setInterval(() => {
        setIdleWarning(prev => {
          if (!prev.show) return prev;
          const next = Math.max(0, prev.remainingMs - 1000);
          return { ...prev, remainingMs: next };
        });
      }, 1000);
    };
    window.addEventListener('idle-warning', handler);
    // also update localStorage when general settings broadcast to ensure AuthContext sees change
    const onGeneralEvent = (e) => {
      try {
        const g = e && e.detail ? e.detail : null;
        // Only update autoLogoutMinutes when the payload explicitly includes the setting
        if (g && Object.prototype.hasOwnProperty.call(g, 'autoLogoutMinutes')) {
          try {
            const val = typeof g.autoLogoutMinutes === 'number' ? g.autoLogoutMinutes : (g.autoLogoutMinutes ? Number(g.autoLogoutMinutes) : 0);
            localStorage.setItem('autoLogoutMinutes', String(Number.isNaN(val) ? 0 : val));
          } catch (_) {}
        }
      } catch (_) {}
    };
    window.addEventListener('general-settings-updated', onGeneralEvent);
    return () => {
      window.removeEventListener('idle-warning', handler);
      window.removeEventListener('general-settings-updated', onGeneralEvent);
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, []);

  useEffect(() => {
    if (!idleWarning.show) return;
    if (idleWarning.remainingMs <= 0) {
      setIdleWarning({ show: false, remainingMs: 0 });
    }
  }, [idleWarning.show, idleWarning.remainingMs]);

  const { replaceToken, refreshWithCookie } = useAuth();
  const extendSession = async () => {
    try {
      const newToken = await refreshWithCookie();
      if (newToken) {
        try { replaceToken(newToken); } catch (_) {}
      }
    } catch (_) {}
    try { window.dispatchEvent(new Event('extend-session')); } catch (_) {}
    setIdleWarning({ show: false, remainingMs: 0 });
  };
  // small SVG fallback (data URI) used when no avatar is found
  const FALLBACK_AVATAR = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
    <svg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 24 24' fill='none'>
      <rect width='24' height='24' rx='12' fill='%23122333' />
      <path d='M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3z' fill='%23dbe8ef' opacity='0.95'/>
      <path d='M4 20c0-2.667 4-4 8-4s8 1.333 8 4v0H4z' fill='%23dbe8ef' opacity='0.95'/>
    </svg>
  `);
  const role = (accountProfile || profile)?.role;
  
  const getAvatarSrc = (p) => {
    if (!p) return null;
    if (p.avatar_url) {
      try {
        if (p.avatar_url.startsWith('http://') || p.avatar_url.startsWith('https://')) return p.avatar_url;
        // when developing locally, backend runs on :3001
        const origin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
        const base = origin + p.avatar_url;
        try {
          const v = localStorage.getItem('avatar_refresh');
          return v ? `${base}${base.includes('?') ? '&' : '?'}v=${v}` : base;
        } catch (e) { return base; }
      } catch (e) { return p.avatar_url; }
    }
    if (p.avatar_data) return p.avatar_data;
    return null;
  };

  // Always fetch the authoritative account record for the header (strong consistency)
  // helper to fetch the authoritative account record for the header (strong consistency)
  const fetchAccount = async () => {
    try {
      if (!token) return;
      // determine id from profile or localStorage
      const id = profile?.id || (profile && profile.user && profile.user.id) || (() => { try { const s = localStorage.getItem('user'); return s ? JSON.parse(s).id : null; } catch(e){ return null; } })();
      if (!id) return;
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      const res = await fetch(backendOrigin + `/api/admin/accounts/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setAccountProfile(data);
        return;
      }
      // if auth-protected endpoint fails (403), attempt a public avatar fetch so banner can still show uploaded image
      if (res.status === 403 || res.status === 401) {
        try {
          // try to resolve the id (from profile or localStorage)
          const uid = id;
          if (!uid) return;
          const publicRes = await fetch(backendOrigin + `/api/admin/public/accounts/${uid}/avatar`);
          if (!publicRes.ok) return;
          const p = await publicRes.json();
          if (p.type === 'url') {
            setAccountProfile(prev => ({ ...(prev || {}), avatar_url: p.url }));
          } else if (p.type === 'data') {
            setAccountProfile(prev => ({ ...(prev || {}), avatar_data: p.data }));
          }
        } catch (e) {
          // ignore public fetch errors
        }
      }
    } catch (err) {
      // ignore
    }
  };

  useEffect(() => { fetchAccount(); }, [token, profile]);

  const effectiveProfile = accountProfile || profile;
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [avatarSrc, setAvatarSrc] = useState(() => getAvatarSrc(accountProfile || profile) || FALLBACK_AVATAR);
  // servers for profile modal so read-only list can show names (not just IDs)
  const [profileServers, setProfileServers] = useState([]);

  // debug: show what profile and avatar src resolve to in the browser console
  try {
     
    console.debug('[App] effectiveProfile:', effectiveProfile, ' avatarSrc:', getAvatarSrc(effectiveProfile) || FALLBACK_AVATAR);
  } catch (e) {}

  // keep a local avatarSrc updated when the authoritative profile or cache-buster changes
  useEffect(() => {
    let mounted = true;
    const candidate = getAvatarSrc(effectiveProfile);
    if (!candidate) {
      setAvatarSrc(FALLBACK_AVATAR);
      return undefined;
    }
    // data URLs or base64 can be used immediately
    if (candidate.startsWith('data:')) {
      setAvatarSrc(candidate);
      return undefined;
    }

    // attempt a HEAD fetch with a small retry/backoff strategy so the banner updates
    // quickly as soon as the upload becomes available
    const checkWithRetry = async () => {
      const maxAttempts = 4; // total attempts
      const baseDelay = 200; // ms
      for (let attempt = 0; attempt < maxAttempts && mounted; attempt++) {
        try {
          const res = await fetch(candidate, { method: 'HEAD' });
          if (!mounted) return;
          if (res && res.ok) {
            setAvatarSrc(candidate);
            return;
          }
        } catch (err) {
          // swallow network/CORS errors for retry
        }

        // if we have avatar_data, prefer showing that while we retry
        if (effectiveProfile && effectiveProfile.avatar_data) {
          setAvatarSrc(effectiveProfile.avatar_data);
        }

        // wait before next attempt
        const delay = baseDelay * Math.pow(2, attempt); // exponential backoff: 200,400,800...
        await new Promise(r => setTimeout(r, delay));
      }

      // if all attempts failed, fall back to avatar_data or fallback icon
      if (!mounted) return;
      if (effectiveProfile && effectiveProfile.avatar_data) {
        setAvatarSrc(effectiveProfile.avatar_data);
      } else {
        setAvatarSrc(FALLBACK_AVATAR);
      }
      // do not persist settings here; general settings are broadcast via events elsewhere
    };

    checkWithRetry();
    return () => { mounted = false; };
  }, [effectiveProfile]);

  // Fetch servers list so the profile modal can map IDs -> names.
  // Non-admins will receive only their accessible servers; admins receive all.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!token) return;
        const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
  const rs = await axios.get(backendOrigin + '/api/servers', { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true });
  if (rs.status === 401 || rs.status === 403) return;
        if (cancelled) return;
        const d2 = rs.data;
        const normalized2 = Array.isArray(d2) ? d2 : (d2 && Array.isArray(d2.data) ? d2.data : (d2 && Array.isArray(d2.servers) ? d2.servers : []));
        setProfileServers(normalized2);
      } catch (err) {
        // non-fatal; list will fall back to showing IDs
        try { console.debug('Failed to fetch servers for profile modal', err); } catch(e) {}
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // listen for avatar_refresh or other storage updates (other tab/editor) and refresh avatar
  useEffect(() => {
    const handler = (e) => {
      if (!e || !e.key || e.key === 'avatar_refresh') {
        const src = getAvatarSrc(effectiveProfile) || FALLBACK_AVATAR;
        setAvatarSrc(src);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [effectiveProfile]);

  // ref used to detect clicks outside the avatar/menu
  const avatarRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const leaveTimerRef = useRef(null);
  const isTouchRef = useRef(false);

  // Detect touch-capable device to avoid hover behavior on touch
  useEffect(() => {
    try {
      isTouchRef.current = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    } catch (e) { isTouchRef.current = false; }
  }, []);

  // Close menu when clicking outside or on Escape. Also cleanup timers.
  useEffect(() => {
    const onDocClick = (e) => {
      if (!avatarRef.current) return;
      if (!avatarRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
      clearTimeout(hoverTimerRef.current);
      clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Hover handlers (desktop): small delay before opening/closing to avoid flicker
  const handleMouseEnter = () => {
    if (isTouchRef.current) return;
    clearTimeout(leaveTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setMenuOpen(true), 180);
  };
  const handleMouseLeave = () => {
    if (isTouchRef.current) return;
    clearTimeout(hoverTimerRef.current);
    leaveTimerRef.current = setTimeout(() => setMenuOpen(false), 220);
  };

  // Theme selection helpers
  const setThemeOverride = (mode) => {
    if (!['system','dark','light'].includes(mode)) return;
    try { localStorage.setItem('themeOverride', mode); } catch (_) {}
    setAppTheme(mode);
  };

  return (
    <ToastProvider>
    <div className="app-container">
      {/* This is the single, main header for the entire application */}
      <div className="main-header">
  {/* Brand logo on the far left (70x70). If a logo_url exists in General settings, render an <img>; else render blank circle with subtle icon */}
        <Link to="/" className="main-logo" aria-label="Home">
          {/* runtime swap handled via CSS & data attributes; render both for simplicity */}
          <span className="main-logo-circle" aria-hidden="true" />
          <img className="main-logo-img" alt="Logo" sizes="70px" />
          <FaLeaf className="main-logo-fallback" aria-hidden="true" />
        </Link>
        <Link to="/" className="main-title-link">
          <div className="main-title" role="heading" aria-level={1}>
            <span className="brand">{appTitle || 'YN Paradise'}</span>
            <span className="sub">Customer Management Portal</span>
          </div>
        </Link>
        <nav className="main-nav" aria-label="Primary">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Dashboard</NavLink>
          <NavLink to="/financial" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Financial</NavLink>
          <NavLink to="/server-list" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Server List</NavLink>
          {role === 'ADMIN' && <NavLink to="/admin" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Admin</NavLink>}
          {role === 'ADMIN' && <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>Settings</NavLink>}
        </nav>
        {/* Logout moved into avatar menu */}
        {/* Avatar on the right side of the banner */}
          <div ref={avatarRef} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="header-avatar" title={(effectiveProfile && (effectiveProfile.name || effectiveProfile.display_name || effectiveProfile.email)) || 'Profile'}>
            <img
              src={avatarSrc}
              alt="User avatar"
              className="header-avatar-img"
              onError={(e) => { e.target.onerror = null; e.target.src = FALLBACK_AVATAR; }}
            />
            <button
              type="button"
              className="header-avatar-overlay"
              aria-label="Open menu"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={(e) => { e.preventDefault(); e.stopPropagation();
                // on touch devices, toggle; on desktop clicks also toggle but hover takes precedence
                setMenuOpen(prev => !prev);
              }}
            >
              {/* menu icon (hamburger) per reference */}
              <svg className="header-overlay-icon" width="13" height="10" viewBox="0 0 18 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M1 1.5h16" stroke="#062226" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M1 6h16" stroke="#062226" strokeWidth="1.2" strokeLinecap="round" />
                <path d="M1 10.5h16" stroke="#062226" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>

            {/* Small contextual menu anchored to the avatar overlay */}
            {menuOpen && (
              <div className="avatar-menu" role="menu" aria-label="Profile menu">
                <button type="button" className="avatar-menu-item" role="menuitem" onClick={() => { setShowProfileEditor(true); setMenuOpen(false); }}>
                  <FaUser className="menu-icon" aria-hidden />
                  <span>Profile</span>
                </button>
                <div className="avatar-menu-divider" aria-hidden="true" />
                <div className="avatar-menu-subheader" aria-hidden="true">Theme</div>
                <div className="avatar-menu-group" role="group" aria-label="Theme">
                  <button
                    type="button"
                    className="avatar-menu-item"
                    role="menuitemradio"
                    aria-checked={appTheme === 'system'}
                    onClick={(e) => { e.stopPropagation(); setThemeOverride('system'); }}
                  >
                    <FaDesktop className="menu-icon" aria-hidden />
                    <span>System</span>
                    {appTheme === 'system' && <FaCheck className="menu-check" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    className="avatar-menu-item"
                    role="menuitemradio"
                    aria-checked={appTheme === 'dark'}
                    onClick={(e) => { e.stopPropagation(); setThemeOverride('dark'); }}
                  >
                    <FaMoon className="menu-icon" aria-hidden />
                    <span>Dark</span>
                    {appTheme === 'dark' && <FaCheck className="menu-check" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    className="avatar-menu-item"
                    role="menuitemradio"
                    aria-checked={appTheme === 'light'}
                    onClick={(e) => { e.stopPropagation(); setThemeOverride('light'); }}
                  >
                    <FaSun className="menu-icon" aria-hidden />
                    <span>Light</span>
                    {appTheme === 'light' && <FaCheck className="menu-check" aria-hidden />}
                  </button>
                </div>
                <div className="avatar-menu-divider" aria-hidden="true" />
                <button type="button" className="avatar-menu-item" role="menuitem" onClick={() => { setMenuOpen(false); try { logout(); } catch (e) {} }}>
                  <FaSignOutAlt className="menu-icon" aria-hidden />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
          
          {/* Profile editor modal (re-uses AdminEditorForm) */}
          <AdminEditorForm
            isOpen={showProfileEditor}
            onClose={() => setShowProfileEditor(false)}
            onSaved={() => { setShowProfileEditor(false); try { localStorage.setItem('avatar_refresh', String(Date.now())); } catch (e) {} fetchAccount(); }}
            account={effectiveProfile}
            servers={profileServers}
          />
      </div>

      {/* Child pages (like the dashboard) will be rendered here */}
      <Outlet />
      <BackToTop />
      <IdleToast isOpen={idleWarning.show} remainingMs={idleWarning.remainingMs} onExtend={extendSession} onClose={() => setIdleWarning({ show: false, remainingMs: 0 })} />
    </div>
    </ToastProvider>
  );
}

export default App;

