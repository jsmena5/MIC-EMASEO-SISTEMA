import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { changePasswordRequest } from "../../auth/authService"
import { clearAuthTokens, getAccessToken, getStoredUser } from "../../auth/authSession"

type FieldState = { value: string; show: boolean }

const EyeIcon = ({ open }: { open: boolean }) =>
  open ? (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )

const REQUIREMENTS = [
  { label: "Al menos 8 caracteres",        test: (p: string) => p.length >= 8 },
  { label: "Una letra mayúscula",           test: (p: string) => /[A-Z]/.test(p) },
  { label: "Una letra minúscula",           test: (p: string) => /[a-z]/.test(p) },
  { label: "Un número",                     test: (p: string) => /[0-9]/.test(p) },
]

export default function Settings() {
  const navigate  = useNavigate()
  const user      = getStoredUser()

  const [current,  setCurrent]  = useState<FieldState>({ value: "", show: false })
  const [next,     setNext]     = useState<FieldState>({ value: "", show: false })
  const [confirm,  setConfirm]  = useState<FieldState>({ value: "", show: false })

  const [loading,  setLoading]  = useState(false)
  const [success,  setSuccess]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const passwordsMatch = next.value === confirm.value && confirm.value !== ""
  const allReqsMet     = REQUIREMENTS.every(r => r.test(next.value))
  const canSubmit      = current.value !== "" && allReqsMet && passwordsMatch && !loading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    const token = getAccessToken()
    if (!token) { navigate("/", { replace: true }); return }

    setLoading(true)
    setError(null)

    try {
      await changePasswordRequest(current.value, next.value, token)
      setSuccess(true)
      // Revocar sesión local — el backend ya revocó los refresh tokens
      setTimeout(() => {
        clearAuthTokens()
        navigate("/", { replace: true })
      }, 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cambiar la contraseña")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-full items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl border border-green-200 bg-green-50 p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <svg className="h-8 w-8 text-green-600" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-extrabold text-green-800">¡Contraseña actualizada!</h2>
          <p className="mt-2 text-sm text-green-700">Serás redirigido al inicio de sesión en unos segundos.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50 p-6 md:p-10">
      <div className="mx-auto max-w-xl">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-slate-900">Configuración</h1>
          <p className="mt-1 text-sm text-slate-500">
            Cuenta: <span className="font-semibold text-slate-700">{user?.nombre ?? user?.username ?? "—"}</span>
            <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-600 uppercase tracking-wide">
              {user?.rol}
            </span>
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-bold text-slate-800">Cambiar contraseña</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Después de cambiarla, deberás iniciar sesión de nuevo.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-6">

            {/* Error global */}
            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <p className="text-sm font-medium text-red-700">{error}</p>
              </div>
            )}

            {/* Contraseña actual */}
            <PasswordField
              id="current"
              label="Contraseña actual"
              value={current.value}
              show={current.show}
              onChange={v => setCurrent(s => ({ ...s, value: v }))}
              onToggleShow={() => setCurrent(s => ({ ...s, show: !s.show }))}
              autoComplete="current-password"
            />

            {/* Nueva contraseña */}
            <PasswordField
              id="new"
              label="Nueva contraseña"
              value={next.value}
              show={next.show}
              onChange={v => setNext(s => ({ ...s, value: v }))}
              onToggleShow={() => setNext(s => ({ ...s, show: !s.show }))}
              autoComplete="new-password"
            />

            {/* Requisitos */}
            {next.value.length > 0 && (
              <ul className="grid grid-cols-2 gap-1.5 pl-1">
                {REQUIREMENTS.map(r => {
                  const ok = r.test(next.value)
                  return (
                    <li key={r.label} className={`flex items-center gap-1.5 text-xs font-medium ${ok ? "text-green-600" : "text-slate-400"}`}>
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${ok ? "bg-green-100" : "bg-slate-100"}`}>
                        {ok ? "✓" : "○"}
                      </span>
                      {r.label}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Confirmar */}
            <PasswordField
              id="confirm"
              label="Confirmar nueva contraseña"
              value={confirm.value}
              show={confirm.show}
              onChange={v => setConfirm(s => ({ ...s, value: v }))}
              onToggleShow={() => setConfirm(s => ({ ...s, show: !s.show }))}
              autoComplete="new-password"
              error={confirm.value.length > 0 && !passwordsMatch ? "Las contraseñas no coinciden" : undefined}
            />

            {/* Acción */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-2 w-full rounded-xl bg-[#005BAC] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#004B8E] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Guardando…" : "Cambiar contraseña"}
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Campo de contraseña reutilizable ─────────────────────────────────────────

function PasswordField({
  id, label, value, show, onChange, onToggleShow, autoComplete, error,
}: {
  id: string
  label: string
  value: string
  show: boolean
  onChange: (v: string) => void
  onToggleShow: () => void
  autoComplete?: string
  error?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          onChange={e => onChange(e.target.value)}
          className={`w-full rounded-xl border px-4 py-3 pr-11 text-sm text-slate-900 outline-none transition focus:ring-2 focus:ring-[#005BAC]/30 ${
            error ? "border-red-400 bg-red-50 focus:border-red-400" : "border-slate-200 bg-slate-50 focus:border-[#005BAC]"
          }`}
        />
        <button
          type="button"
          onClick={onToggleShow}
          tabIndex={-1}
          className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        >
          <EyeIcon open={show} />
        </button>
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
