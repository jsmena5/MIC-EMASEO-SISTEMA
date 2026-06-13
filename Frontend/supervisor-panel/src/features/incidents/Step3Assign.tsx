import { useState } from "react"
import type { IncidentDetail, IncidentEstado, OperarioItem } from "../../services/incident.service"
import { asignarIncidente, cambiarEstado } from "../../services/incident.service"
import { fieldStyle, labelStyle } from "./styles"

const TRANSICIONES: Record<string, IncidentEstado[]> = {
  PENDIENTE:   ["EN_ATENCION", "RECHAZADA"],
  EN_ATENCION: ["RESUELTA", "RECHAZADA", "PENDIENTE"],
  EN_REVISION: ["PENDIENTE", "RECHAZADA"],
  DESCARTADO:  ["PENDIENTE"],
}

const LABEL: Partial<Record<IncidentEstado, string>> = {
  PENDIENTE:   "Volver a pendiente",
  EN_ATENCION: "Enviar a operario",
  RECHAZADA:   "Rechazar",
  RESUELTA:    "Marcar resuelta",
}

// Promisifica la API de geolocalización del browser
function captureGPS(): Promise<{ cierre_lat: number; cierre_lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Tu dispositivo no soporta geolocalización"))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ cierre_lat: pos.coords.latitude, cierre_lon: pos.coords.longitude }),
      (err) => reject(new Error(`No se pudo obtener GPS: ${err.message}`)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  })
}

export default function Step3Assign({
  detail, operarios, onRefresh,
}: Readonly<{
  detail: IncidentDetail
  operarios: OperarioItem[]
  onRefresh: () => void
}>) {
  const [selected,     setSelected]     = useState("")
  const [notas,        setNotas]        = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [saving,       setSaving]       = useState(false)
  const [capturandoGps, setCapturandoGps] = useState(false)
  const [feedback,     setFeedback]     = useState<string | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  const handleAssign = async () => {
    if (!selected) { setError("Selecciona un operario."); return }
    setSaving(true); setError(null); setFeedback(null)
    try {
      await asignarIncidente(detail.id, selected, null, notas)
      setFeedback("Incidente asignado correctamente.")
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo asignar.")
    } finally {
      setSaving(false)
    }
  }

  // Cierre con geocerca: captura GPS y luego marca RESUELTA con la ubicación.
  const resolverConGps = async (estado: IncidentEstado) => {
    setCapturandoGps(true)
    let gps: { cierre_lat: number; cierre_lon: number }
    try {
      gps = await captureGPS()
    } catch (err) {
      setCapturandoGps(false)
      setError(err instanceof Error ? err.message : "Error al capturar GPS")
      return
    }
    setCapturandoGps(false)
    setSaving(true)
    try {
      const res = await cambiarEstado(detail.id, estado, observaciones, gps)
      const dist = res.distancia_cierre_m
      const distSuffix = dist == null ? "" : ` Distancia al punto: ${dist} m.`
      setFeedback(`Reporte cerrado correctamente.${distSuffix}`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar el reporte.")
    } finally {
      setSaving(false)
    }
  }

  // Transición simple (sin GPS): PENDIENTE / EN_ATENCION / RECHAZADA.
  const cambiarEstadoSimple = async (estado: IncidentEstado) => {
    setSaving(true)
    try {
      await cambiarEstado(detail.id, estado, observaciones)
      setFeedback(`Estado actualizado a ${estado.replaceAll("_", " ").toLowerCase()}.`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.")
    } finally {
      setSaving(false)
    }
  }

  const handleEstado = async (estado: IncidentEstado) => {
    setError(null); setFeedback(null)
    // Al cerrar (RESUELTA) se requiere GPS para validar la geocerca
    if (estado === "RESUELTA") {
      await resolverConGps(estado)
    } else {
      await cambiarEstadoSimple(estado)
    }
  }

  const transiciones = TRANSICIONES[detail.estado] ?? []
  const canAssign    = ["PENDIENTE", "EN_ATENCION"].includes(detail.estado)
  const isBusy       = saving || capturandoGps

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-base font-extrabold text-slate-900">Asignar al equipo de campo</h3>
        <p className="mt-1 text-xs text-slate-500">
          El caso ya fue validado y clasificado. Elige un operario para despacharlo.
        </p>
      </div>

      {canAssign && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3">
            <div className="grid gap-1">
              <label htmlFor="s3-operario" style={labelStyle}>Operario</label>
              <select id="s3-operario" value={selected} onChange={(e) => setSelected(e.target.value)} style={fieldStyle}>
                <option value="">Selecciona un operario</option>
                {operarios.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre_completo}
                    {o.zona_nombre ? ` · ${o.zona_nombre}` : ""}
                    {` (${o.asignaciones_activas} activas)`}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1">
              <label htmlFor="s3-notas" style={labelStyle}>Notas para la cuadrilla</label>
              <textarea
                id="s3-notas"
                rows={3}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Indicaciones específicas para el operario."
                style={{ ...fieldStyle, resize: "vertical", minHeight: 70, fontFamily: "inherit" }}
              />
            </div>

            <div className="flex justify-end">
              <button
                disabled={isBusy || !selected}
                onClick={() => void handleAssign()}
                className="rounded-xl bg-[#005BAC] px-4 py-2 text-sm font-bold text-white hover:bg-[#004B8E] disabled:opacity-50"
              >
                {saving ? "Asignando…" : "Asignar y enviar a campo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transiciones.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Cambio de estado</div>

          {/* Aviso geocerca: solo aparece cuando RESUELTA está disponible */}
          {transiciones.includes("RESUELTA") && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-xs text-emerald-700">
                Al marcar como <strong>Resuelta</strong> se capturará tu ubicación GPS para validar que estás en el punto del reporte.
              </p>
            </div>
          )}

          <textarea
            rows={2}
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            placeholder="Observaciones de la transición (visible en trazabilidad)."
            style={{ ...fieldStyle, resize: "vertical", minHeight: 60, fontFamily: "inherit", marginTop: 8 }}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {transiciones.map((e) => (
              <button
                key={e}
                disabled={isBusy}
                onClick={() => void handleEstado(e)}
                className={(() => {
                  let variant: string
                  if (e === "RECHAZADA") variant = "bg-red-50 text-red-700 hover:bg-red-100"
                  else if (e === "RESUELTA") variant = "bg-green-50 text-green-700 hover:bg-green-100"
                  else variant = "bg-blue-50 text-blue-700 hover:bg-blue-100"
                  return `rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${variant}`
                })()}
              >
                {capturandoGps && e === "RESUELTA"
                  ? "Capturando GPS…"
                  : (LABEL[e] ?? e)}
              </button>
            ))}
          </div>
        </div>
      )}

      {feedback && <div className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">{feedback}</div>}
      {error    && <div className="rounded-lg bg-red-50  px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
    </div>
  )
}
