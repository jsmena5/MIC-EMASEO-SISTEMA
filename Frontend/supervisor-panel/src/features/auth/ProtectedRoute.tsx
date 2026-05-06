import { Navigate, Outlet, useLocation } from "react-router-dom";
import { getStoredUser } from "../../shared/utils/jwt";

const ALLOWED_ROLES = ["ADMIN", "SUPERVISOR"];

export default function ProtectedRoute() {
  const location = useLocation();
  const user = getStoredUser();

  if (!user || !ALLOWED_ROLES.includes(user.rol)) {
    localStorage.removeItem("token");
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
