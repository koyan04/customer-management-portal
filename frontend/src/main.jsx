import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import App from './App.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ServerDetailPage from './pages/ServerDetailPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import AdminPanelPage from './pages/AdminPanelPage.jsx';
import ServerListPage from './pages/ServerListPage.jsx';
import AdminOnlyRoute from './components/AdminOnlyRoute.jsx';
import './index.css';

// This new Root component will provide the AuthContext to all other routes
function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />, // The Root component is now the top-level element
    children: [
      {
        path: "/login",
        element: <LoginPage />,
      },
      {
        path: "/",
        element: <ProtectedRoute />,
        children: [
          {
            element: <App />,
            children: [
              {
                index: true,
                element: <DashboardPage />,
              },
              {
                path: 'server-list',
                element: <ServerListPage />,
              },
              {
                path: "servers/:id",
                element: <ServerDetailPage />,
              },
              {
                path: "admin",
                element: <AdminOnlyRoute />,
                children: [
                  {
                    index: true,
                    element: <AdminPanelPage />,
                  }
                ]
              },
              {/* change-password page moved inside the Admin panel */}
            ],
          },
        ],
      },
    ]
  }
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Now, the RouterProvider is the top-level wrapper, as required */}
    <RouterProvider router={router} />
  </React.StrictMode>,
);

