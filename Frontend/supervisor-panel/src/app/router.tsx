import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "../features/auth/LoginPage";
import ProtectedRoute from "../features/auth/ProtectedRoute";
import DashboardLayout from "../features/dashboard/DashboardLayout";
import Home from "../features/dashboard/pages/Home";
import Reports from "../features/dashboard/pages/Reports";
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
          { index: true, element: <Navigate to="incidencias" replace /> },
          { path: "home", element: <Home /> },
          { path: "users", element: <Navigate to="/dashboard/home" replace /> },
          { path: "reports", element: <Navigate to="/dashboard/incidencias" replace /> },
          { path: "settings", element: <Navigate to="/dashboard/home" replace /> },
          { path: "incidencias", element: <Reports /> },
          { path: "mapa", element: <MapaZonas /> },
          { path: "*", element: <Navigate to="/dashboard/incidencias" replace /> }
        ]
      }
    ]
  }
]);
