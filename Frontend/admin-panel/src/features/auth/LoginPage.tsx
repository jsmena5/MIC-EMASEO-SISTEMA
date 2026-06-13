import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import type { Location } from "react-router-dom"
import { useAuth } from "./useAuth"
import { getAuthenticatedUser } from "./authSession"

const ALLOWED_ROLES = ["ADMIN"]
const DEFAULT_PANEL_ROUTE = "/dashboard/home"

type LoginRouteState = { from?: Location }

export default function LoginPage() {
  const { login, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const [showSplash,   setShowSplash]   = useState(true)
  const [email,        setEmail]        = useState("")
  const [password,     setPassword]     = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error,        setError]        = useState("")

  const getSafeRedirectPath = useCallback(() => {
    const state = location.state as LoginRouteState | null
    const from  = state?.from
    if (!from?.pathname.startsWith("/dashboard")) return DEFAULT_PANEL_ROUTE
    return `${from.pathname}${from.search}${from.hash}`
  }, [location.state])

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2000)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    getAuthenticatedUser(ALLOWED_ROLES).then((user) => {
      if (!cancelled && user) navigate(getSafeRedirectPath(), { replace: true })
    })
    return () => { cancelled = true }
  }, [getSafeRedirectPath, navigate])

  const handleLogin = async () => {
    if (!email || !password) { setError("Todos los campos son obligatorios"); return }
    setError("")
    setIsSubmitting(true)
    try {
      const user = await login(email, password)
      if (ALLOWED_ROLES.includes(user.rol)) {
        navigate(getSafeRedirectPath(), { replace: true })
      } else {
        await logout()
        setError("Acceso restringido a administradores")
      }
    } catch {
      setError("Credenciales incorrectas")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleLogin()
  }

  if (showSplash) {
    return (
      <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-indigo-950 animate-fade-in">
        <div className="text-center animate-pulse">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z" />
                <path d="M9.5 12.5l1.8 1.8L15 10.5" />
              </svg>
            </div>
          </div>
          <h1 className="text-3xl font-extrabold text-white">EMASEO EP</h1>
          <p className="mt-2 text-indigo-200 text-sm font-medium tracking-wider uppercase">Panel Administrador</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-indigo-900 via-indigo-700 to-indigo-950 px-4">
      <div className="w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l7 3v5c0 4.5-3 7.5-7 10-4-2.5-7-5.5-7-10V6z" />
                <path d="M9.5 12.5l1.8 1.8L15 10.5" />
              </svg>
            </div>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300">EMASEO EP</div>
          <h2 className="mt-1 text-xl font-extrabold text-white">Panel Administrador</h2>
          <p className="mt-1 text-sm text-indigo-300">Acceso exclusivo para administradores del sistema</p>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-white/20 bg-white/10 p-8 backdrop-blur-xl shadow-2xl">
          {error && (
            <div className="mb-4 rounded-xl border border-red-400/30 bg-red-500/20 px-4 py-2.5 text-sm text-red-200">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold text-indigo-200 uppercase tracking-wider">Correo electrónico</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="admin@emaseo.gob.ec"
                className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 text-white placeholder-indigo-300 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-semibold text-indigo-200 uppercase tracking-wider">Contraseña</label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/20 bg-white/10 px-4 py-3 pr-16 text-white placeholder-indigo-300 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400/30 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-indigo-300 hover:text-white transition"
                >
                  {showPassword ? "Ocultar" : "Ver"}
                </button>
              </div>
            </div>

            <button
              onClick={() => void handleLogin()}
              disabled={isSubmitting}
              className="mt-2 w-full rounded-xl bg-indigo-500 px-4 py-3.5 text-sm font-bold text-white shadow-lg hover:bg-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60 transition"
            >
              {isSubmitting ? "Verificando…" : "Ingresar"}
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-indigo-400">
          Sistema de Gestión Inteligente de Residuos · EMASEO EP
        </p>
      </div>
    </div>
  )
}
