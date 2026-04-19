import { createBrowserRouter } from "react-router-dom";
import LoginPage from "../features/auth/LoginPage";
import DashboardLayout from "../features/dashboard/DashboardLayout";
import Home from "../features/dashboard/pages/Home";
import Users from "../features/dashboard/pages/Users";
import Reports from "../features/dashboard/pages/Reports";
import Settings from "../features/dashboard/pages/Settings";

export const router = createBrowserRouter([
  { path: "/", element: <LoginPage /> },
  {
    path: "/dashboard",
    element: <DashboardLayout />,
    children: [
      { path: "home", element: <Home /> },
      { path: "users", element: <Users /> },
      { path: "reports", element: <Reports /> },
      { path: "settings", element: <Settings /> }
    ]
  }
]);