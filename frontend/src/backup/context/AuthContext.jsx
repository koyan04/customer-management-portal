import React, { createContext, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const navigate = useNavigate();
  // Check localStorage for an existing token on initial load
  const [token, setToken] = useState(localStorage.getItem('token'));

  const login = (newToken) => {
    setToken(newToken);
    localStorage.setItem('token', newToken);
    navigate('/'); // Redirect to the main dashboard after login
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('token');
    navigate('/login'); // Redirect to login page after logout
  };

  return (
    <AuthContext.Provider value={{ token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to easily use the auth context in other components
export const useAuth = () => {
  return useContext(AuthContext);
};
