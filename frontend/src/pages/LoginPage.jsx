import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { FaLock, FaMoon, FaSun, FaDesktop } from 'react-icons/fa';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const [appTheme, setAppTheme] = useState('system');
  const [systemEffective, setSystemEffective] = useState(() => {
    try { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; } catch (_) { return 'dark'; }
  });

  // keep in sync with the App-level theme handling
  useEffect(() => {
    try {
      const override = localStorage.getItem('themeOverride');
      if (override === 'dark' || override === 'light' || override === 'system') {
        setAppTheme(override);
        // Apply immediately on initial load of Login page
        const applyTheme = (preferred) => {
          const isSystemDark = (() => {
            try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; }
          })();
          const effective = preferred === 'system' ? (isSystemDark ? 'dark' : 'light') : preferred;
          if (effective === 'light') document.body.classList.add('theme-light');
          else document.body.classList.remove('theme-light');
        };
        applyTheme(override);
      }
      const handler = (e) => {
        if (e && e.key === 'themeOverride') {
          const v = e.newValue;
          if (v === 'dark' || v === 'light' || v === 'system') {
            setAppTheme(v);
            // Apply immediately when storage change is detected
            const isSystemDark = (() => {
              try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; }
            })();
            const effective = v === 'system' ? (isSystemDark ? 'dark' : 'light') : v;
            if (effective === 'light') document.body.classList.add('theme-light');
            else document.body.classList.remove('theme-light');
          }
        }
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    } catch (_) {}
  }, []);

  // When in 'system' mode, reflect OS theme changes instantly on the login screen
  useEffect(() => {
    const applyEffective = (preferred) => {
      const isSystemDark = (() => {
        try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; }
      })();
      const effective = preferred === 'system' ? (isSystemDark ? 'dark' : 'light') : preferred;
      setSystemEffective(effective === 'dark' ? 'dark' : 'light');
      if (effective === 'light') document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
    };
    applyEffective(appTheme);
    if (appTheme !== 'system') return;
    let mm;
    try {
      mm = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyEffective('system');
      if (mm && mm.addEventListener) mm.addEventListener('change', listener);
      else if (mm && mm.addListener) mm.addListener(listener);
      return () => {
        if (mm && mm.removeEventListener) mm.removeEventListener('change', listener);
        else if (mm && mm.removeListener) mm.removeListener(listener);
      };
    } catch (_) { /* ignore */ }
    return undefined;
  }, [appTheme]);

  const setThemeOverride = (mode) => {
    if (!['system','dark','light'].includes(mode)) return;
    try { localStorage.setItem('themeOverride', mode); } catch (_) {}
    setAppTheme(mode);
    // Apply immediately to body on Login page
    try {
      const isSystemDark = (() => {
        try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return true; }
      })();
      const effective = mode === 'system' ? (isSystemDark ? 'dark' : 'light') : mode;
      if (effective === 'light') document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
    } catch (_) {}
    // dispatch a small event so App can pick it up instantly if loaded
    try { window.dispatchEvent(new StorageEvent('storage', { key: 'themeOverride', newValue: mode })); } catch (_) {}
  };

  // login page logo: fetch the public general settings endpoint and read logo_url (preferred),
  // otherwise fall back to the local vite.svg placeholder.
  const [loginLogoSrc, setLoginLogoSrc] = useState('/vite.svg');
  const [loginLogoSrcSet, setLoginLogoSrcSet] = useState(undefined);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const origin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? `${window.location.protocol}//${window.location.hostname}:3001` : '';
        const res = await fetch(origin + '/api/admin/public/settings/general');
        if (!res || !res.ok) return;
        const data = await res.json();
        const general = data && data.data ? data.data : {};
        if (!mounted) return;
        if (general) {
          const url1x = general.logo_url ? (origin + general.logo_url) : null;
          const url2x = general.logo_url_2x ? (origin + general.logo_url_2x) : null;
          if (url1x) setLoginLogoSrc(url1x);
          if (url2x) setLoginLogoSrcSet(url1x ? `${url1x} 1x, ${url2x} 2x` : `${url2x} 2x`);
          // if only 2x present and no 1x, use 2x as src so browsers have something
          if (!url1x && url2x) setLoginLogoSrc(url2x);
        }
      } catch (_) {
        // ignore and keep placeholder
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post('http://localhost:3001/api/auth/login', {
        username,
        password,
      });
      // The login function from AuthContext handles saving the token and redirecting
      login(response.data.token);
    } catch (err) {
      setError('Invalid username or password.');
      console.error('Login failed:', err);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-theme-toggle" role="group" aria-label="Theme">
          <button type="button" className={`theme-dot${appTheme==='system'?' active':''}`} title="System" onClick={() => setThemeOverride('system')}>
            <FaDesktop aria-hidden />
          </button>
          <button type="button" className={`theme-dot${appTheme==='dark'?' active':''}${appTheme==='system' && systemEffective==='dark' ? ' effective' : ''}`} title="Dark" onClick={() => setThemeOverride('dark')}>
            <FaMoon aria-hidden />
          </button>
          <button type="button" className={`theme-dot${appTheme==='light'?' active':''}${appTheme==='system' && systemEffective==='light' ? ' effective' : ''}`} title="Light" onClick={() => setThemeOverride('light')}>
            <FaSun aria-hidden />
          </button>
        </div>
        <div className="login-header">
          {/* Brand logo: reuse main banner logo when available, fallback to vite.svg */}
          <div className="login-logo">
            <img src={loginLogoSrc} srcSet={loginLogoSrcSet} alt="Brand logo" className="login-logo-img" />
          </div>
          <h2>Admin Portal</h2>
          <p className="login-subtitle">Sign in to continue</p>
          <FaLock className="lock-icon" />
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="submit-btn login-btn">Sign In</button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
