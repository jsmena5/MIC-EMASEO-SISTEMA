import { useState } from "react"
import type {
  IncidentDetail,
  NivelAcum,
  RevisionIAPayload,
  TipoResiduo,
} from "../../services/incident.service"
import { cambiarEstado, revisionIA } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
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
  detail, onRefresh,
}: {
  detail: IncidentDetail
  onRefresh: () => void
}) {
  const [form, setForm] = useState<RevisionIAPayload>(getInitialForm(detail))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)

  const handleSave = async (markRevisado: boolean) => {
    setSaving(true)
    setError(null)
    try {
      await revisionIA(detail.id, form)
      if (markRevisado && detail.estado === "PENDIENTE") {
        await cambiarEstado(detail.id, "REVISADO")
      }
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      {/* Imagen con lightbox */}
      {imageUrl && (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-900"
            title="Click para ver en grande"
          >
            <img
              src={imageUrl}
              alt="Incidente"
              className="aspect-video w-full object-contain"
            />
          </button>
          {lightboxOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
              onClick={() => setLightboxOpen(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setLightboxOpen(false) }}
            >
              <button
                type="button"
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
                onClick={() => setLightboxOpen(false)}
              >
                ✕
              </button>
              <button type="button" className="focus:outline-none" onClick={(e) => e.stopPropagation()}>
                <img
                  src={imageUrl}
                  alt="Incidente ampliado"
                  className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
                />
              </button>
            </div>
          )}
        </>
      )}

      <div>
        <h3 className="text-base font-extrabold text-slate-900">Validar la clasificación de la IA</h3>
        <p className="mt-1 text-xs text-slate-500">
          La IA propuso un tipo de residuo y un nivel de acumulación. Confirma o corrige antes de guardar.
        </p>
      </div>

      <div className="grid gap-2">
        <span style={labelStyle}>¿La IA acertó?</span>
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
          <label htmlFor="s2-tipo" style={labelStyle}>Tipo de residuo final</label>
          <select
            id="s2-tipo"
            value={form.tipo_residuo_supervisor ?? ""}
            onChange={(e) => setForm({ ...form, tipo_residuo_supervisor: (e.target.value as TipoResiduo) || null })}
            style={fieldStyle}
          >
            <option value="">Sin definir</option>
            {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        <div className="grid gap-1">
          <label htmlFor="s2-nivel" style={labelStyle}>Nivel de acumulación</label>
          <select
            id="s2-nivel"
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
        <label htmlFor="s2-comentario" style={labelStyle}>Comentario para auditoría</label>
        <textarea
          id="s2-comentario"
          rows={4}
          value={form.comentario ?? ""}
          onChange={(e) => setForm({ ...form, comentario: e.target.value })}
          placeholder="Describe por qué la IA acertó o en qué se equivocó. Sirve para retroalimentar el modelo."
          style={{ ...fieldStyle, resize: "vertical", minHeight: 100, fontFamily: "inherit" }}
        />
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="mr-auto text-xs text-slate-500">
          <strong>Guardar borrador</strong>: guarda sin cambiar estado.<br />
          <strong>Confirmar revisión</strong>: guarda y marca el caso como <em>REVISADO</em>.
        </div>
        <button
          disabled={saving}
          onClick={() => handleSave(false)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar borrador"}
        </button>
        <button
          disabled={saving}
          onClick={() => handleSave(true)}
          className="rounded-xl bg-[#005BAC] px-4 py-2 text-sm font-bold text-white hover:bg-[#004B8E] disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Confirmar revisión"}
        </button>
      </div>
    </div>
  )
}
