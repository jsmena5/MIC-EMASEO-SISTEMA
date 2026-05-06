import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AUTH_SESSION_CLEARED_EVENT, getAuthenticatedUser } from "./authSession";

const ALLOWED_ROLES = ["ADMIN", "SUPERVISOR"];

export default function ProtectedRoute() {
  const location = useLocation();
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking");

  const validateSession = useCallback(async (cancelled: () => boolean) => {
    const user = await getAuthenticatedUser(ALLOWED_ROLES);

    if (!cancelled()) {
      setStatus(user ? "allowed" : "denied");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const runValidation = () => {
      void validateSession(isCancelled);
    };

    const timeout = window.setTimeout(runValidation, 0);
    const interval = window.setInterval(runValidation, 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [location.pathname, location.search, validateSession]);

  useEffect(() => {
    const handleSessionCleared = () => setStatus("denied");

    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);

    return () => {
      window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, handleSessionCleared);
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-950 text-white">
        Validando sesion...
      </div>
    );
  }

  if (status === "denied") {
    return <Navigate to="/" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
