/**
 * ReviewModal — modal que contiene el flujo de revisión (Step1 → Step2).
 * Se abre desde IncidentPreview cuando el supervisor hace clic en "Revisar incidencia".
 * Mantiene su propia máquina de estados (step, reject mode) sin contaminar la bandeja.
 */
import { useEffect, useRef, useState } from "react"
import type { IncidentDetail, RevisionIAPayload, NivelAcum, TipoResiduo } from "../../services/incident.service"
import { cambiarEstado, revisionIA } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import { NIVEL_LABEL, TIPO_LABEL, fieldStyle, labelStyle } from "./styles"
import { MOTIVO_RECHAZO_LABEL, type MotivoRechazo as MR } from "../../types/incident"

type ModalStep = "validate" | "classify" | "reject"

function getInitialClassify(d: IncidentDetail): RevisionIAPayload {
  return {
    es_correcta_ia: d.ia_fue_correcta ?? true,
    comentario: d.nota_supervision ?? "",
    nivel_acumulacion_supervisor: d.nivel_acumulacion_supervisor ?? d.nivel_acumulacion ?? null,
    tipo_residuo_supervisor: d.tipo_residuo_supervisor ?? d.tipo_residuo ?? null,
  }
}

export default function ReviewModal({
  detail,
  initialStep = "validate",
  onClose,
  onDone,
}: Readonly<{
  detail: IncidentDetail
  initialStep?: ModalStep
  onClose: () => void
  onDone: () => void
}>) {
  const [step, setStep] = useState<ModalStep>(initialStep)
  const [form, setForm] = useState<RevisionIAPayload>(getInitialClassify(detail))
  const [motivoRechazo, setMotivoRechazo] = useState<MR | "">("")
  const [observaciones, setObservaciones] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    globalThis.window.addEventListener("keydown", handler)
    return () => globalThis.window.removeEventListener("keydown", handler)
  }, [onClose])

  const handleConfirmReview = async (markRevisado: boolean) => {
    setSaving(true); setError(null)
    try {
      await revisionIA(detail.id, form)
      if (markRevisado && detail.estado === "PENDIENTE") {
        await cambiarEstado(detail.id, "REVISADO")
      }
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.")
    } finally {
      setSaving(false)
    }
  }

  const handleReject = async () => {
    if (!motivoRechazo) { setError("Selecciona un motivo."); return }
    setSaving(true); setError(null)
    try {
      await cambiarEstado(detail.id, "RECHAZADA", { motivo_rechazo: motivoRechazo, observaciones: observaciones.trim() || undefined })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo rechazar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div aria-hidden="true" className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <div
        ref={dialogRef}
        className="relative flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        {/* ── Header del modal ──────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              #{detail.id.slice(0, 8)} · {detail.zona_nombre ?? "Zona sin definir"}
            </div>
            <h3 className="text-base font-extrabold text-slate-900">
              {step === "validate" && "Validar incidencia"}
              {step === "classify" && "Clasificar análisis IA"}
              {step === "reject"   && "Rechazar reporte"}
            </h3>
          </div>
          {/* Progress pills */}
          <div className="flex items-center gap-1.5 mr-8">
            {(["validate", "classify"] as ModalStep[]).map((s, i) => (
              <div key={s} className={(() => {
                let variant: string
                if (step === s) variant = "bg-[#005BAC]"
                else if (step === "classify" && i === 0) variant = "bg-green-400"
                else variant = "bg-slate-200"
                return `h-1.5 w-8 rounded-full transition-colors ${variant}`
              })()} />
            ))}
          </div>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 text-lg"
          >
            ✕
          </button>
        </div>

        {/* ── Cuerpo scrollable ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 grid gap-5">

          {/* Imagen compacta siempre visible */}
          {imageUrl && (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-slate-200 bg-slate-900"
              title="Click para ampliar"
            >
              <img src={imageUrl} alt="Incidente" className="h-48 w-full object-contain" />
            </button>
          )}

          {/* ── STEP: Validate ────────────────────────────────── */}
          {step === "validate" && (
            <div className="grid gap-4">
              <p className="text-sm text-slate-600">
                Revisa la imagen y confirma si hay acumulación de residuos en el lugar.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setStep("classify")}
                  className="rounded-xl border-2 border-green-400 bg-green-50 p-4 text-left hover:bg-green-100 transition"
                >
                  <div className="text-sm font-extrabold text-green-700">✓ Es real</div>
                  <div className="mt-1 text-xs text-slate-500">Continuar a clasificar</div>
                </button>
                <button
                  onClick={() => { setStep("reject"); setError(null) }}
                  className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-left hover:bg-red-100 transition"
                >
                  <div className="text-sm font-extrabold text-red-700">✕ No es real</div>
                  <div className="mt-1 text-xs text-slate-500">Rechazar el reporte</div>
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: Classify ────────────────────────────────── */}
          {step === "classify" && (
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setForm({ ...form, es_correcta_ia: true })}
                  className={["rounded-xl border-2 p-3 text-left transition", form.es_correcta_ia ? "border-green-500 bg-green-50" : "border-slate-200 hover:border-green-300"].join(" ")}
                >
                  <div className="text-sm font-bold text-slate-900">IA acertó</div>
                  <div className="text-[11px] text-slate-500">El análisis es preciso</div>
                </button>
                <button
                  onClick={() => setForm({ ...form, es_correcta_ia: false })}
                  className={["rounded-xl border-2 p-3 text-left transition", form.es_correcta_ia === false ? "border-red-500 bg-red-50" : "border-slate-200 hover:border-red-300"].join(" ")}
                >
                  <div className="text-sm font-bold text-slate-900">IA se equivocó</div>
                  <div className="text-[11px] text-slate-500">Corregir clasificación</div>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <label htmlFor="rm-tipo" style={labelStyle}>Tipo de residuo</label>
                  <select
                    id="rm-tipo"
                    value={form.tipo_residuo_supervisor ?? ""}
                    onChange={(e) => setForm({ ...form, tipo_residuo_supervisor: (e.target.value as TipoResiduo) || null })}
                    style={fieldStyle}
                  >
                    <option value="">Sin definir</option>
                    {Object.entries(TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="grid gap-1">
                  <label htmlFor="rm-nivel" style={labelStyle}>Nivel de acumulación</label>
                  <select
                    id="rm-nivel"
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
                <label htmlFor="rm-comentario" style={labelStyle}>Comentario para auditoría <span className="text-slate-300">(opcional)</span></label>
                <textarea
                  id="rm-comentario"
                  rows={3}
                  value={form.comentario ?? ""}
                  onChange={(e) => setForm({ ...form, comentario: e.target.value })}
                  placeholder="¿Por qué acertó o en qué se equivocó la IA?"
                  style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
            </div>
          )}

          {/* ── STEP: Reject ──────────────────────────────────── */}
          {step === "reject" && (
            <div className="grid gap-4">
              <p className="text-sm text-slate-600">Indica por qué el reporte no puede ser atendido.</p>
              <div className="grid gap-1">
                <label htmlFor="rm-motivo" style={labelStyle}>Motivo <span className="text-red-500">*</span></label>
                <select
                  id="rm-motivo"
                  value={motivoRechazo}
                  onChange={(e) => { setMotivoRechazo(e.target.value as MR | ""); setError(null) }}
                  style={fieldStyle}
                >
                  <option value="">— Selecciona un motivo —</option>
                  {(Object.entries(MOTIVO_RECHAZO_LABEL) as [MR, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <label htmlFor="rm-obs" style={labelStyle}>Observaciones <span className="text-slate-300">(opcional)</span></label>
                <textarea
                  id="rm-obs"
                  rows={3}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Detalle adicional para el registro."
                  style={{ ...fieldStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>
          )}
        </div>

        {/* ── Footer con acciones ────────────────────────────────── */}
        <div className="shrink-0 border-t border-slate-100 px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={step === "validate" ? onClose : () => { setStep("validate"); setError(null) }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            {step === "validate" ? "Cancelar" : "← Atrás"}
          </button>

          <div className="flex items-center gap-2">
            {step === "classify" && (
              <button
                disabled={saving}
                onClick={() => handleConfirmReview(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar borrador"}
              </button>
            )}
            {step === "classify" && (
              <button
                disabled={saving}
                onClick={() => handleConfirmReview(true)}
                className="rounded-xl bg-[#005BAC] px-5 py-2 text-sm font-bold text-white hover:bg-[#004B8E] disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Confirmar revisión ✓"}
              </button>
            )}
            {step === "reject" && (
              <button
                disabled={saving || !motivoRechazo}
                onClick={handleReject}
                className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Rechazando…" : "Confirmar rechazo"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxOpen && imageUrl && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightboxOpen(false) }}
        >
          <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white text-lg" onClick={() => setLightboxOpen(false)}>✕</button>
          <img src={imageUrl} alt="ampliado" className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain" />
        </div>
      )}
    </div>
  )
}
