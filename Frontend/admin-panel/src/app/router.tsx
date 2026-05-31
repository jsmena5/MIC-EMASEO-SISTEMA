import { createBrowserRouter, Navigate } from "react-router-dom"
import LoginPage from "../features/auth/LoginPage"
import ProtectedRoute from "../features/auth/ProtectedRoute"
import DashboardLayout from "../features/dashboard/DashboardLayout"
import Home from "../features/dashboard/pages/Home"
import Supervisores from "../features/dashboard/pages/Supervisores"
import Zonas from "../features/dashboard/pages/Zonas"
import Configuracion from "../features/dashboard/pages/Configuracion"
import FeedbackIA from "../features/dashboard/pages/FeedbackIA"

export const router = createBrowserRouter([
  { path: "/",  element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/dashboard",
        element: <DashboardLayout />,
        children: [
          { index: true, element: <Navigate to="home" replace /> },
          { path: "home",         element: <Home /> },
          { path: "supervisores", element: <Supervisores /> },
          { path: "zonas",        element: <Zonas /> },
          { path: "configuracion", element: <Configuracion /> },
          { path: "ia",           element: <FeedbackIA /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
])
