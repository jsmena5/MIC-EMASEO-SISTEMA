import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "../features/auth/LoginPage";
import ProtectedRoute from "../features/auth/ProtectedRoute";
import DashboardLayout from "../features/dashboard/DashboardLayout";
import Home from "../features/dashboard/pages/Home";
import IncidentsPage from "../features/incidents/IncidentsPage";
import MapaZonas from "../features/dashboard/pages/MapaZonas";
import Settings from "../features/dashboard/pages/Settings";

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
          { path: "incidencias", element: <IncidentsPage /> },
          { path: "mapa",           element: <MapaZonas /> },
          { path: "configuracion", element: <Settings /> },
          { path: "*",             element: <Navigate to="/dashboard/incidencias" replace /> }
        ]
      }
    ]
  }
]);
