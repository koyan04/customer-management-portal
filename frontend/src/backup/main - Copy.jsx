import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App.jsx';
import DashboardPage from './pages/DashboardPage.jsx'; // Import Dashboard
import ServerDetailPage from './pages/ServerDetailPage.jsx';
import './index.css';

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />, // App is now the main layout element
    children: [ // These are the pages that will render inside App's <Outlet />
      {
        index: true, // This makes DashboardPage the default child route for "/"
        element: <DashboardPage />,
      },
      {
        path: "servers/:id",
        element: <ServerDetailPage />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);