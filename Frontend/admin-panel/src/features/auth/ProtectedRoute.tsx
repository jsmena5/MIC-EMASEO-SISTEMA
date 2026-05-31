import { useCallback, useEffect, useState } from "react"
import { Navigate, Outlet, useLocation } from "react-router-dom"
import { AUTH_SESSION_CLEARED_EVENT, getAuthenticatedUser } from "./authSession"

const ALLOWED_ROLES = ["ADMIN"]

export default function ProtectedRoute() {
  const location = useLocation()
  const [status, setStatus] = useState<"checking" | "allowed" | "denied">("checking")

  const validateSession = useCallback(async (cancelled: () => boolean) => {
    const user = await getAuthenticatedUser(ALLOWED_ROLES)
    if (!cancelled()) setStatus(user ? "allowed" : "denied")
  }, [])

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    const run = () => void validateSession(isCancelled)

    const timeout  = window.setTimeout(run, 0)
    const interval = window.setInterval(run, 60_000)
    return () => { cancelled = true; window.clearTimeout(timeout); window.clearInterval(interval) }
  }, [location.pathname, location.search, validateSession])

  useEffect(() => {
    const handleCleared = () => setStatus("denied")
    window.addEventListener(AUTH_SESSION_CLEARED_EVENT, handleCleared)
    return () => window.removeEventListener(AUTH_SESSION_CLEARED_EVENT, handleCleared)
  }, [])

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-indigo-950 text-white text-sm">
        Validando sesión…
      </div>
    )
  }
  if (status === "denied") {
    return <Navigate to="/" replace state={{ from: location }} />
  }
  return <Outlet />
}
