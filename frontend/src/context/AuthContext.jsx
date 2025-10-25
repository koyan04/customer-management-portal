import React, { createContext, useState, useContext, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// lightweight JWT payload decoder (no external dependency)
function decodeJwt(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    // atob is available in browsers; decode percent-encoded utf8 safely
    const json = decodeURIComponent(Array.prototype.map.call(atob(payload), c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  // Check localStorage for an existing token on initial load
  const [token, setToken] = useState(localStorage.getItem('token'));
  const expiryTimerRef = useRef(null);

  // derive user info from token (if present)
  const user = useMemo(() => {
    if (!token) return null;
    return decodeJwt(token);
  }, [token]);

  const login = (newToken) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
    // persist decoded user payload for legacy components that read localStorage('user')
    try {
      const decoded = decodeJwt(newToken);
      if (decoded && decoded.user) localStorage.setItem('user', JSON.stringify(decoded.user));
    } catch (e) { /* ignore */ }
    navigate('/'); // Redirect to the main dashboard after login
  };

  // replace current token (used after refresh)
  const replaceToken = (newToken) => {
    if (!newToken) return;
    setToken(newToken);
    try { localStorage.setItem('token', newToken); } catch (e) {}
    try {
      const decoded = decodeJwt(newToken);
      if (decoded && decoded.user) localStorage.setItem('user', JSON.stringify(decoded.user));
    } catch (e) {}
  };

  // call refresh endpoint (cookie-based) to rotate refresh token and return new access token
  const refreshWithCookie = async () => {
    try {
      const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
      const res = await fetch(backendOrigin + '/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res || !res.ok) return null;
      const data = await res.json();
      if (data && data.token) {
        replaceToken(data.token);
        return data.token;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  const logout = () => {
    (async () => {
      try {
        const backendOrigin = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3001' : '';
        // Call logout endpoint which clears the refresh cookie and server-side row
        await fetch(backendOrigin + '/api/auth/logout', { method: 'POST', credentials: 'include', headers: {} }).catch(() => {});
      } catch (e) {}
      setToken(null);
      localStorage.removeItem('token');
      try { localStorage.removeItem('user'); } catch(e) {}
      navigate('/login'); // Redirect to login page after logout
    })();
  };

  // Idle auto-logout: reads `autoLogoutMinutes` from localStorage (0 = disabled)
  useEffect(() => {
    let idleTimer = null;
    let lastActivity = Date.now();
    let warningTimer = null;
    const getMinutes = () => {
      try { return Number(localStorage.getItem('autoLogoutMinutes') || '0'); } catch (e) { return 0; }
    };
    const resetTimer = () => {
      lastActivity = Date.now();
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (warningTimer) { clearTimeout(warningTimer); warningTimer = null; }
      const minutes = getMinutes();
      if (!token || !minutes || minutes <= 0) return; // disabled or not logged in
      const ms = minutes * 60 * 1000;
      // schedule warning 60 seconds before logout (if duration allows)
      const warnBefore = Math.min(60 * 1000, Math.max(0, ms - 1000));
      if (ms > 60 * 1000) {
        warningTimer = setTimeout(() => {
          const remaining = Math.max(0, ms - (Date.now() - lastActivity));
          // dispatch a global event to show UI warning; include remaining ms
          try { window.dispatchEvent(new CustomEvent('idle-warning', { detail: { remainingMs: remaining } })); } catch (e) {}
        }, ms - 60 * 1000);
      }
      idleTimer = setTimeout(() => {
        // double-check visibility and lastActivity to avoid race conditions
        const elapsed = Date.now() - lastActivity;
        if (elapsed >= ms) {
          try { logout(); } catch (e) {}
        }
      }, ms + 200);
    };

    const activityHandler = () => resetTimer();
    const visibilityHandler = () => {
      // when tab becomes visible, reset the timer so background idle doesn't immediately log out
      if (!document.hidden) resetTimer();
    };

    // attach events
    window.addEventListener('mousemove', activityHandler);
    window.addEventListener('mousedown', activityHandler);
    window.addEventListener('keydown', activityHandler);
    window.addEventListener('touchstart', activityHandler);
    window.addEventListener('scroll', activityHandler);
    document.addEventListener('visibilitychange', visibilityHandler);

    // respond to storage changes (other tabs updating autoLogoutMinutes)
    const storageHandler = (e) => {
      if (!e || e.key === 'autoLogoutMinutes') resetTimer();
    };
    // listen for programmatic 'extend-session' events (e.g., user clicked extend in warning modal)
      const extendHandler = () => resetTimer();
    window.addEventListener('extend-session', extendHandler);
    window.addEventListener('storage', storageHandler);

    // start the timer initially
    resetTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (warningTimer) clearTimeout(warningTimer);
      window.removeEventListener('mousemove', activityHandler);
      window.removeEventListener('mousedown', activityHandler);
      window.removeEventListener('keydown', activityHandler);
      window.removeEventListener('touchstart', activityHandler);
      window.removeEventListener('scroll', activityHandler);
      document.removeEventListener('visibilitychange', visibilityHandler);
      window.removeEventListener('storage', storageHandler);
      window.removeEventListener('extend-session', extendHandler);
    };
  }, [token]);

  // Auto-logout when token is expired (or about to expire)
  useEffect(() => {
    // clear previous timer
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    if (!token) return;
    const payload = decodeJwt(token);
    if (!payload || !payload.exp) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const secondsLeft = payload.exp - nowSec;
    if (secondsLeft <= 0) {
      logout();
      return;
    }
    // schedule logout slightly after token expiry
    expiryTimerRef.current = setTimeout(() => {
      try { logout(); } catch (e) {}
    }, secondsLeft * 1000 + 500);
    return () => {
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, login, logout, user, replaceToken, refreshWithCookie }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to easily use the auth context in other components
export const useAuth = () => {
  return useContext(AuthContext);
};
