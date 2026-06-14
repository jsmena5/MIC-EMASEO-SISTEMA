import { useCallback, useState, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import type { Location } from "react-router-dom"
import { useAuth } from "./useAuth"
import { getAuthenticatedUser } from "./authSession"
import { forgotPasswordRequest } from "./authService"
import { Mail, Lock, Eye, EyeOff, ShieldCheck, ArrowLeft, CheckCircle } from "lucide-react"

const ALLOWED_ROLES  = ["ADMIN", "SUPERVISOR"]
const DEFAULT_ROUTE  = "/dashboard/home"

type LoginState = { from?: Location }
type View = "login" | "forgot" | "forgot-sent"

export default function LoginPage() {
  const { login, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()

  const [view,         setView]         = useState<View>("login")
  const [showSplash,   setShowSplash]   = useState(true)
  const [email,        setEmail]        = useState("")
  const [password,     setPassword]     = useState("")
  const [forgotEmail,  setForgotEmail]  = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe,   setRememberMe]   = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState("")

  const getRedirect = useCallback(() => {
    const from = (location.state as LoginState | null)?.from
    if (!from?.pathname.startsWith("/dashboard")) return DEFAULT_ROUTE
    return `${from.pathname}${from.search}${from.hash}`
  }, [location.state])

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 1800)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    let alive = true
    getAuthenticatedUser(ALLOWED_ROLES).then(user => {
      if (alive && user) navigate(getRedirect(), { replace: true })
    })
    return () => { alive = false }
  }, [getRedirect, navigate])

  const handleLogin = async () => {
    if (!email || !password) { setError("Completa todos los campos"); return }
    setError(""); setSubmitting(true)
    try {
      const user = await login(email, password)
      if (ALLOWED_ROLES.includes(user.rol)) {
        navigate(getRedirect(), { replace: true })
      } else {
        await logout()
        setError("Tu cuenta no tiene acceso a este panel")
      }
    } catch {
      setError("Correo o contraseña incorrectos")
    } finally {
      setSubmitting(false)
    }
  }

  const handleForgot = async () => {
    if (!forgotEmail) { setError("Ingresa tu correo"); return }
    setError(""); setSubmitting(true)
    try {
      await forgotPasswordRequest(forgotEmail)
      setView("forgot-sent")
    } catch {
      // Por seguridad no revelamos si el correo existe
      setView("forgot-sent")
    } finally {
      setSubmitting(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (view === "login") void handleLogin()
      else if (view === "forgot") void handleForgot()
    }
  }

  // ── Splash ─────────────────────────────────────────────────────────────────
  if (showSplash) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: BG }}>
        <div className="text-center animate-pulse">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <ShieldCheck size={32} color="white" strokeWidth={1.5} />
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/60">EMASEO EP</p>
          <h1 className="mt-1 text-2xl font-extrabold text-white">Panel de Supervisión</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen items-center justify-center px-4" style={{ background: BG }}>

      {/* Card glassmorphism */}
      <div style={cardStyle}>

        {/* Logo */}
        <div className="mb-7 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
            <ShieldCheck size={24} color="white" strokeWidth={1.6} />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/50">EMASEO EP</p>
          <h2 className="text-lg font-extrabold text-white">
            {view === "login" ? "Panel de Supervisión" : "Recuperar contraseña"}
          </h2>
          {view === "login" && (
            <p className="text-xs text-white/50">Acceso para supervisores y administradores</p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-xl border border-red-300/30 bg-red-500/20 px-4 py-2.5 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* ── VISTA: LOGIN ─────────────────────────────────────── */}
        {view === "login" && (
          <div className="space-y-3">
            <Field icon={<Mail size={15} color="rgba(255,255,255,0.5)" />}
              type="email" placeholder="Correo electrónico" value={email}
              onChange={setEmail} onKeyDown={onKey} autoComplete="email" />

            <div className="relative">
              <Field icon={<Lock size={15} color="rgba(255,255,255,0.5)" />}
                type={showPassword ? "text" : "password"} placeholder="Contraseña"
                value={password} onChange={setPassword} onKeyDown={onKey}
                autoComplete="current-password" />
              <button type="button" onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>

            {/* Recordar + Olvidé */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <label className="flex items-center gap-2 text-white/60 cursor-pointer select-none">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-white/70" />
                Recordar sesión
              </label>
              <button type="button" onClick={() => { setView("forgot"); setError(""); setForgotEmail(email) }}
                className="text-white/60 hover:text-white transition">
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            <button onClick={() => void handleLogin()} disabled={submitting}
              className="mt-1 w-full rounded-xl bg-white py-3 text-sm font-bold text-slate-800 shadow-md hover:bg-white/90 disabled:opacity-60 transition">
              {submitting ? "Verificando…" : "Ingresar"}
            </button>
          </div>
        )}

        {/* ── VISTA: FORGOT ────────────────────────────────────── */}
        {view === "forgot" && (
          <div className="space-y-4">
            <p className="text-sm text-white/60 text-center">
              Ingresa tu correo y te enviaremos instrucciones para restablecer tu contraseña.
            </p>
            <Field icon={<Mail size={15} color="rgba(255,255,255,0.5)" />}
              type="email" placeholder="Tu correo electrónico" value={forgotEmail}
              onChange={setForgotEmail} onKeyDown={onKey} autoComplete="email" />
            <button onClick={() => void handleForgot()} disabled={submitting}
              className="w-full rounded-xl bg-white py-3 text-sm font-bold text-slate-800 shadow-md hover:bg-white/90 disabled:opacity-60 transition">
              {submitting ? "Enviando…" : "Enviar instrucciones"}
            </button>
            <button type="button" onClick={() => { setView("login"); setError("") }}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition mx-auto">
              <ArrowLeft size={13} /> Volver al inicio de sesión
            </button>
          </div>
        )}

        {/* ── VISTA: FORGOT SENT ───────────────────────────────── */}
        {view === "forgot-sent" && (
          <div className="flex flex-col items-center gap-4 py-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15">
              <CheckCircle size={28} color="white" strokeWidth={1.6} />
            </div>
            <div>
              <p className="font-bold text-white">Revisa tu correo</p>
              <p className="mt-1 text-sm text-white/55">
                Si tu correo está registrado, recibirás un mensaje con instrucciones en los próximos minutos.
              </p>
            </div>
            <button type="button" onClick={() => { setView("login"); setError("") }}
              className="mt-2 flex items-center gap-1.5 text-xs text-white/55 hover:text-white/80 transition">
              <ArrowLeft size={13} /> Volver al inicio de sesión
            </button>
          </div>
        )}

        <p className="mt-7 text-center text-[10px] text-white/30">
          Sistema de Gestión Inteligente de Residuos · EMASEO EP
        </p>
      </div>
    </div>
  )
}

// ── Campo de formulario ───────────────────────────────────────────────────────

function Field({ icon, type, placeholder, value, onChange, onKeyDown, autoComplete }: Readonly<{
  icon: React.ReactNode
  type: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  autoComplete?: string
}>) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-3">
      <span className="shrink-0">{icon}</span>
      <input type={type} placeholder={placeholder} value={value} autoComplete={autoComplete}
        onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
        className="flex-1 bg-transparent text-sm text-white placeholder-white/40 focus:outline-none min-w-0"
      />
    </div>
  )
}

// ── Estilos constantes ────────────────────────────────────────────────────────

const BG = "linear-gradient(155deg, #c5d8e0 0%, #8eb0c0 20%, #5a8898 45%, #3a6478 70%, #243e50 100%)"

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  background: "rgba(255,255,255,0.10)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(255,255,255,0.20)",
  borderRadius: 24,
  padding: "36px 32px",
  boxShadow: "0 20px 60px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.15) inset",
}
