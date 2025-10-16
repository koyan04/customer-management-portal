import React, { createContext, useState, useContext, useMemo } from 'react';
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

  const logout = () => {
    setToken(null);
    localStorage.removeItem('token');
    try { localStorage.removeItem('user'); } catch(e) {}
    navigate('/login'); // Redirect to login page after logout
  };

  return (
    <AuthContext.Provider value={{ token, login, logout, user }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to easily use the auth context in other components
export const useAuth = () => {
  return useContext(AuthContext);
};
