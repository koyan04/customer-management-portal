// React 19+ auto JSX runtime: no need to import React when not referencing it directly
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
