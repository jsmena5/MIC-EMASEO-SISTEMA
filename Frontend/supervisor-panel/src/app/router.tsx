import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "../features/auth/LoginPage";
import ProtectedRoute from "../features/auth/ProtectedRoute";
import DashboardLayout from "../features/dashboard/DashboardLayout";
import Home from "../features/dashboard/pages/Home";
import Users from "../features/dashboard/pages/Users";
import Reports from "../features/dashboard/pages/Reports";
import Settings from "../features/dashboard/pages/Settings";
import MapaZonas from "../features/dashboard/pages/MapaZonas";

export const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> },
  {
    path: "/dashboard",
    element: <ProtectedRoute />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="home" replace /> },
          { path: "home", element: <Home /> },
          { path: "users", element: <Users /> },
          { path: "reports", element: <Reports /> },
          { path: "settings", element: <Settings /> },
          { path: "mapa", element: <MapaZonas /> }
        ]
      }
    ]
  }
]);
