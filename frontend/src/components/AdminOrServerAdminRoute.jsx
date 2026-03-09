import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminOrServerAdminRoute() {
  const { token, user } = useAuth();

  if (!token) return <Navigate to="/login" replace />;

  const role = user?.user?.role || user?.role;
  if (role !== 'ADMIN' && role !== 'SERVER_ADMIN') return <Navigate to="/" replace />;

  return <Outlet />;
}
