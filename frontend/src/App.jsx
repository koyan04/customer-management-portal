import { Outlet, Link } from 'react-router-dom';
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import './App.css';
import AdminEditorForm from './components/AdminEditorForm';
import { FaUser, FaSignOutAlt } from 'react-icons/fa';
import axios from 'axios';

function App() {
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
    // eslint-disable-next-line no-console
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
        const rs = await axios.get(backendOrigin + '/api/servers', { headers: { Authorization: `Bearer ${token}` } });
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

  return (
    <div className="app-container">
      {/* This is the single, main header for the entire application */}
      <div className="main-header">
        <Link to="/" className="main-title-link">
          <h1>YN Paradise Customer Management Portal</h1>
        </Link>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Link to="/server-list" className="server-list-link">Server List</Link>
                  {role === 'ADMIN' && <Link to="/admin" className="admin-link">Admin</Link>}
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
      </div>

      {/* Child pages (like the dashboard) will be rendered here */}
      <Outlet />
    </div>
  );
}

export default App;

