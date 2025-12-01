import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function ProtectedRoute() {
  const { token } = useAuth();

  // If there's no token, redirect to the /login page
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // If there is a token, render the main App layout
  return <Outlet />;
}

export default ProtectedRoute;
