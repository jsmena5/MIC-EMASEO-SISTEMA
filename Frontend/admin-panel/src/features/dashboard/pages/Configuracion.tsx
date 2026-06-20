import { useEffect, useState } from "react"
import { getConfig, setConfig } from "../../../services/zona.service"
import { getAccessToken } from "../../auth/authSession"
import { changePasswordRequest } from "../../auth/authService"
import { API_URL } from "../../../config/env"

// ─── Config section ───────────────────────────────────────────────────────────

function GeofenceConfig() {
  const [value,   setValue]   = useState("")
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState("")
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    getConfig("geofence_tolerancia_m")
      .then(({ valor }) => { setValue(valor); setLoading(false) })
      .catch(() => { setValue("10"); setLoading(false) })
  }, [])

  const handleSave = async () => {
    const num = Number.parseFloat(value)
    if (Number.isNaN(num) || num <= 0 || num > 500) {
      setError("Ingresa un valor entre 1 y 500 metros"); return
    }
    setError(""); setSaving(true)
    try {
      await setConfig("geofence_tolerancia_m", String(Math.round(num)))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
          <svg className="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Tolerancia de geocerca de cierre</h3>
          <p className="text-xs text-slate-500">Radio máximo (en metros) para validar que el operario está en el lugar al resolver un reporte</p>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-slate-400">Cargando configuración…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <input
                type="number"
                min={1}
                max={500}
                step={1}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 pr-16 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-400 font-medium">metros</span>
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          {saved && <p className="text-xs text-emerald-600 font-semibold">¡Configuración guardada!</p>}
          <p className="text-xs text-slate-500">
            Valor recomendado: <strong>10 m</strong> (default). Máximo: 500 m.<br />
            Si el operario está a más de este radio al intentar resolver un reporte, el cierre será rechazado.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Change password ──────────────────────────────────────────────────────────

function ChangePasswordSection() {
  const [current,   setCurrent]   = useState("")
  const [next,      setNext]      = useState("")
  const [confirm,   setConfirm]   = useState("")
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState("")
  const [success,   setSuccess]   = useState(false)

  const handleSubmit = async () => {
    if (!current || !next || !confirm) { setError("Completa todos los campos"); return }
    if (next !== confirm) { setError("Las contraseñas no coinciden"); return }
    if (next.length < 8)  { setError("La contraseña debe tener al menos 8 caracteres"); return }
    setError(""); setSaving(true)
    try {
      const token = getAccessToken()
      if (!token) throw new Error("Sin sesión activa")
      await changePasswordRequest(current, next, token)
      setSuccess(true)
      setCurrent(""); setNext(""); setConfirm("")
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar contraseña")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
          <svg className="h-5 w-5 text-indigo-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Cambiar contraseña</h3>
          <p className="text-xs text-slate-500">Actualiza la contraseña de tu cuenta de administrador</p>
        </div>
      </div>

      <div className="space-y-3 max-w-sm">
        {[
          { label: "Contraseña actual",       value: current, set: setCurrent },
          { label: "Nueva contraseña",         value: next,    set: setNext },
          { label: "Confirmar nueva contraseña", value: confirm, set: setConfirm },
        ].map(({ label, value, set }) => (
          <div key={label}>
            <label className="mb-1 block text-xs font-semibold text-slate-600">{label}</label>
            <input
              type="password"
              value={value}
              onChange={(e) => set(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
            />
          </div>
        ))}
        {error   && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-emerald-600 font-semibold">Contraseña actualizada correctamente.</p>}
        <button
          onClick={() => void handleSubmit()}
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60 transition"
        >
          {saving ? "Cambiando…" : "Cambiar contraseña"}
        </button>
      </div>
    </div>
  )
}

// ─── System info ──────────────────────────────────────────────────────────────

function SystemInfo() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100">
          <svg className="h-5 w-5 text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Información del sistema</h3>
          <p className="text-xs text-slate-500">URLs y versiones activas</p>
        </div>
      </div>
      <dl className="space-y-2 text-sm">
        {[
          { key: "API Gateway", value: API_URL },
          { key: "Panel",       value: globalThis.location.origin },
          { key: "Versión",     value: "v3.0.0" },
          { key: "Ambiente",    value: import.meta.env.DEV ? "Desarrollo" : "Producción" },
        ].map(({ key, value }) => (
          <div key={key} className="flex items-baseline gap-2">
            <dt className="w-28 shrink-0 text-xs font-semibold text-slate-500">{key}</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Configuracion() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">Configuración</h2>
        <p className="text-sm text-slate-500">Parámetros del sistema y preferencias del administrador</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GeofenceConfig />
        <ChangePasswordSection />
      </div>

      <SystemInfo />
    </div>
  )
}
