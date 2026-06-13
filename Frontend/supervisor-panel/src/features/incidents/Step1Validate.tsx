import { useState } from "react"
import type { IncidentDetail } from "../../services/incident.service"
import { cambiarEstado } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import InfoTooltip from "../../shared/components/InfoTooltip"
import { type MotivoRechazo, MOTIVO_RECHAZO_LABEL } from "../../types/incident"
import { DECISION_STYLE, ESTADO_STYLE, fmtPercent, palette } from "./styles"

const MOTIVOS = Object.entries(MOTIVO_RECHAZO_LABEL) as [MotivoRechazo, string][]

export default function Step1Validate({
  detail, onAdvance, onRefresh,
}: Readonly<{
  detail: IncidentDetail
  onAdvance: () => void
  onRefresh: () => void
}>) {
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState<MotivoRechazo | "">("")
  const [observaciones, setObservaciones] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [imgFailed, setImgFailed] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const decision = detail.decision_automatica ? DECISION_STYLE[detail.decision_automatica] : null
  const status   = ESTADO_STYLE[detail.estado] ?? { bg: "#E2E8F0", text: palette.muted }

  // Sugerencia inicial según decisión IA: si IA dijo "incidente válido" sugerimos
  // "Es real"; si dijo "rechazo confiable" sugerimos "No es real".
  const iaSugiereReal     = detail.decision_automatica === "INCIDENTE_VALIDO"
  const iaSugiereDescarte = detail.decision_automatica === "RECHAZO_CONFIABLE"

  const handleDescartar = async () => {
    if (!motivoRechazo) {
      setError("Selecciona un motivo de rechazo.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await cambiarEstado(detail.id, "RECHAZADA", {
        motivo_rechazo: motivoRechazo,
        observaciones: observaciones.trim() || undefined,
      })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descartar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      {/* Imagen grande — click abre lightbox */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
        {imageUrl && !imgFailed ? (
          <button
            type="button"
            className="block h-full w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
            title="Click para ver en grande"
          >
            <img
              src={imageUrl}
              alt="Incidente"
              className="aspect-[4/3] h-full w-full object-contain"
              onError={() => setImgFailed(true)}
            />
          </button>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-300">
            Sin imagen disponible
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && imageUrl && (
        <div
          aria-hidden="true"
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
          <img
            src={imageUrl}
            alt="Incidente ampliado"
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          />
        </div>
      )}

      {/* Acciones */}
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: status.bg, color: status.text }}>
            {detail.estado.replace("_", " ")}
          </span>
          {decision && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: decision.bg, color: decision.text }}>
              IA: {decision.label}
              <InfoTooltip text="Decisión automática de la IA: 'Incidente válido' = confía que hay basura; 'Rechazo confiable' = confía que NO hay basura; 'Revisión requerida' = es ambiguo y debe decidir un humano." />
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            Confianza IA {fmtPercent(detail.confianza_decision ?? detail.confianza)}
            <InfoTooltip text="Qué tan segura está la IA en su decisión, según la detección del modelo sobre la foto. 0% significa que no detectó residuos en la imagen; por eso el caso pasa a revisión manual." />
          </span>
        </div>

        <div>
          <h3 className="text-base font-extrabold text-slate-900">¿Es un reporte real?</h3>
          <p className="mt-1 text-xs text-slate-500">
            Antes de asignar al equipo de campo, confirma con la imagen si efectivamente hay residuos para atender.
          </p>
        </div>

        {!discarding ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={onAdvance}
              className={[
                "rounded-xl border-2 px-4 py-4 text-left transition",
                iaSugiereReal
                  ? "border-green-500 bg-green-50 hover:bg-green-100"
                  : "border-slate-200 bg-white hover:border-green-300",
              ].join(" ")}
            >
              <div className="text-sm font-extrabold text-green-700">✓ Es un reporte real</div>
              <div className="mt-1 text-xs text-slate-600">Pasa a clasificar la incidencia.</div>
              {iaSugiereReal && <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-green-600">Sugerido por IA</div>}
            </button>

            <button
              onClick={() => setDiscarding(true)}
              className={[
                "rounded-xl border-2 px-4 py-4 text-left transition",
                iaSugiereDescarte
                  ? "border-red-300 bg-red-50 hover:bg-red-100"
                  : "border-slate-200 bg-white hover:border-red-300",
              ].join(" ")}
            >
              <div className="text-sm font-extrabold text-red-700">✕ No es real / descartar</div>
              <div className="mt-1 text-xs text-slate-600">Rechaza el reporte con un motivo.</div>
              {iaSugiereDescarte && <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600">Sugerido por IA</div>}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 grid gap-3">
            <div>
              <label htmlFor="s1-motivo" className="text-xs font-bold uppercase tracking-wider text-red-700">
                Motivo de rechazo <span className="text-red-500">*</span>
              </label>
              <select
                id="s1-motivo"
                value={motivoRechazo}
                onChange={(e) => { setMotivoRechazo(e.target.value as MotivoRechazo | ""); setError(null) }}
                className="mt-1.5 w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400"
              >
                <option value="">— Selecciona un motivo —</option>
                {MOTIVOS.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>

            {motivoRechazo === "OTRO" && (
              <div>
                <label htmlFor="s1-obs" className="text-xs font-bold uppercase tracking-wider text-red-700">
                  Observaciones
                </label>
                <textarea
                  id="s1-obs"
                  rows={2}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Describe brevemente el motivo."
                  className="mt-1.5 w-full rounded-lg border border-red-200 bg-white p-2 text-sm outline-none focus:border-red-400"
                />
              </div>
            )}

            {error && <div className="text-xs font-semibold text-red-700">{error}</div>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setDiscarding(false); setMotivoRechazo(""); setObservaciones(""); setError(null) }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                disabled={saving || !motivoRechazo}
                onClick={handleDescartar}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? "Descartando…" : "Confirmar descarte"}
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <div className="font-bold text-slate-700">Contexto</div>
          <div className="mt-1">{detail.zona_nombre ?? "Zona sin definir"} · {detail.ciudadano_nombre ?? "Ciudadano no disponible"}</div>
          {detail.descripcion && <div className="mt-1 italic">"{detail.descripcion}"</div>}
        </div>
      </div>
    </div>
  )
}
