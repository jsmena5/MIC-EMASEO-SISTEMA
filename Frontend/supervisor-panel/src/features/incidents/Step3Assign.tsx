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

export default function Step3Assign({
  detail, operarios, onRefresh,
}: {
  detail: IncidentDetail
  operarios: OperarioItem[]
  onRefresh: () => void
}) {
  const [selected, setSelected] = useState("")
  const [notas, setNotas] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleAssign = async () => {
    if (!selected) {
      setError("Selecciona un operario.")
      return
    }
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

  const handleEstado = async (estado: IncidentEstado) => {
    setSaving(true); setError(null); setFeedback(null)
    try {
      await cambiarEstado(detail.id, estado, observaciones)
      setFeedback(`Estado actualizado a ${estado.replace("_", " ").toLowerCase()}.`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar el estado.")
    } finally {
      setSaving(false)
    }
  }

  const transiciones = TRANSICIONES[detail.estado] ?? []
  const canAssign    = ["PENDIENTE", "EN_ATENCION"].includes(detail.estado)

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
              <label style={labelStyle}>Operario</label>
              <select value={selected} onChange={(e) => setSelected(e.target.value)} style={fieldStyle}>
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
              <label style={labelStyle}>Notas para la cuadrilla</label>
              <textarea
                rows={3}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Indicaciones específicas para el operario."
                style={{ ...fieldStyle, resize: "vertical", minHeight: 70, fontFamily: "inherit" }}
              />
            </div>

            <div className="flex justify-end">
              <button
                disabled={saving || !selected}
                onClick={handleAssign}
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
                disabled={saving}
                onClick={() => handleEstado(e)}
                className={[
                  "rounded-lg px-3 py-2 text-xs font-bold transition disabled:opacity-50",
                  e === "RECHAZADA"
                    ? "bg-red-50 text-red-700 hover:bg-red-100"
                    : e === "RESUELTA"
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-blue-50 text-blue-700 hover:bg-blue-100",
                ].join(" ")}
              >
                {LABEL[e] ?? e}
              </button>
            ))}
          </div>
        </div>
      )}

      {feedback && <div className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">{feedback}</div>}
      {error    && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
    </div>
  )
}
