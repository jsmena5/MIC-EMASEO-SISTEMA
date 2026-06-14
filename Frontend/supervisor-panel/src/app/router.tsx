import { createBrowserRouter, Navigate } from "react-router-dom";
import LoginPage from "../features/auth/LoginPage";
import ProtectedRoute from "../features/auth/ProtectedRoute";
import DashboardLayout from "../features/dashboard/DashboardLayout";
import Home from "../features/dashboard/pages/Home";
import IncidentsLayout from "../features/incidents/IncidentsLayout";
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
          { index: true, element: <Navigate to="home" replace /> },
          { path: "home", element: <Home /> },
          // Ruta principal — IncidentsLayout gestiona las sub-pestañas CASOS y DASHBOARD
          { path: "incidentes", element: <IncidentsLayout /> },
          // Redirect de compatibilidad para links viejos
          { path: "incidencias", element: <Navigate to="/dashboard/incidentes" replace /> },
          { path: "mapa",          element: <MapaZonas /> },
          { path: "configuracion", element: <Settings /> },
          { path: "*",             element: <Navigate to="/dashboard/home" replace /> }
        ]
      }
    ]
  }
]);
