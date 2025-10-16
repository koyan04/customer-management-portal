import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminOnlyRoute() {
  const { token, user } = useAuth();

  if (!token) return <Navigate to="/login" replace />;

  // Expect token to include a role in the decoded payload (e.g., { user: { id, role } } or role directly)
  const role = user?.user?.role || user?.role;
  if (role !== 'ADMIN') return <Navigate to="/" replace />;

  return <Outlet />;
}
