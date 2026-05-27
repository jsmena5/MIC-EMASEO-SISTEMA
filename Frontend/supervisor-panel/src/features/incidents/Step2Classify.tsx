import { useState } from "react"
import type {
  IncidentDetail,
  NivelAcum,
  RevisionIAPayload,
  TipoResiduo,
} from "../../services/incident.service"
import { revisionIA } from "../../services/incident.service"
import { NIVEL_LABEL, TIPO_LABEL, fieldStyle, labelStyle } from "./styles"

function getInitialForm(detail: IncidentDetail): RevisionIAPayload {
  return {
    es_correcta_ia: detail.ia_fue_correcta ?? true,
    comentario: detail.nota_supervision ?? "",
    nivel_acumulacion_supervisor: detail.nivel_acumulacion_supervisor ?? detail.nivel_acumulacion ?? null,
    tipo_residuo_supervisor: detail.tipo_residuo_supervisor ?? detail.tipo_residuo ?? null,
  }
}

export default function Step2Classify({
  detail, onAdvance, onRefresh,
}: {
  detail: IncidentDetail
  onAdvance: () => void
  onRefresh: () => void
}) {
  const [form, setForm] = useState<RevisionIAPayload>(getInitialForm(detail))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async (advance: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await revisionIA(detail.id, form)
      onRefresh()
      if (advance) onAdvance()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <h3 className="text-base font-extrabold text-slate-900">Validar la clasificación de la IA</h3>
        <p className="mt-1 text-xs text-slate-500">
          La IA propuso un tipo de residuo y un nivel de acumulación. Confirma o corrige antes de despachar al campo.
        </p>
      </div>

      <div className="grid gap-2">
        <label style={labelStyle}>¿La IA acertó?</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setForm({ ...form, es_correcta_ia: true })}
            className={[
              "rounded-xl border-2 px-3 py-3 text-left transition",
              form.es_correcta_ia
                ? "border-green-500 bg-green-50"
                : "border-slate-200 bg-white hover:border-green-300",
            ].join(" ")}
          >
            <div className="text-sm font-bold text-slate-900">Sí, está correcta</div>
            <div className="text-[11px] text-slate-500">El análisis automático es preciso.</div>
          </button>
          <button
            onClick={() => setForm({ ...form, es_correcta_ia: false })}
            className={[
              "rounded-xl border-2 px-3 py-3 text-left transition",
              form.es_correcta_ia === false
                ? "border-red-500 bg-red-50"
                : "border-slate-200 bg-white hover:border-red-300",
            ].join(" ")}
          >
            <div className="text-sm font-bold text-slate-900">No, hay que corregir</div>
            <div className="text-[11px] text-slate-500">El supervisor firma la corrección.</div>
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label style={labelStyle}>Tipo de residuo final</label>
          <select
            value={form.tipo_residuo_supervisor ?? ""}
            onChange={(e) => setForm({ ...form, tipo_residuo_supervisor: (e.target.value as TipoResiduo) || null })}
            style={fieldStyle}
          >
            <option value="">Sin definir</option>
            {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="grid gap-1">
          <label style={labelStyle}>Nivel de acumulación</label>
          <select
            value={form.nivel_acumulacion_supervisor ?? ""}
            onChange={(e) => setForm({ ...form, nivel_acumulacion_supervisor: (e.target.value as NivelAcum) || null })}
            style={fieldStyle}
          >
            <option value="">Sin definir</option>
            {Object.entries(NIVEL_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-1">
        <label style={labelStyle}>Comentario para auditoría</label>
        <textarea
          rows={4}
          value={form.comentario ?? ""}
          onChange={(e) => setForm({ ...form, comentario: e.target.value })}
          placeholder="Describe por qué la IA acertó o en qué se equivocó. Sirve para retroalimentar el modelo."
          style={{ ...fieldStyle, resize: "vertical", minHeight: 100, fontFamily: "inherit" }}
        />
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          disabled={saving}
          onClick={() => handleSave(false)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Solo guardar"}
        </button>
        <button
          disabled={saving}
          onClick={() => handleSave(true)}
          className="rounded-xl bg-[#005BAC] px-4 py-2 text-sm font-bold text-white hover:bg-[#004B8E] disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar y asignar →"}
        </button>
      </div>
    </div>
  )
}
