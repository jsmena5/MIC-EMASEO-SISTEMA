import { useState } from "react"
import type { IncidentDetail } from "../../services/incident.service"
import { cambiarEstado } from "../../services/incident.service"
import { DECISION_STYLE, ESTADO_STYLE, fmtPercent, palette } from "./styles"

export default function Step1Validate({
  detail, onAdvance, onRefresh,
}: {
  detail: IncidentDetail
  onAdvance: () => void
  onRefresh: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [error, setError] = useState<string | null>(null)

  const imageUrl = detail.image_url ?? detail.imagen_auditoria_url
  const decision = detail.decision_automatica ? DECISION_STYLE[detail.decision_automatica] : null
  const status   = ESTADO_STYLE[detail.estado] ?? { bg: "#E2E8F0", text: palette.muted }

  // Sugerencia inicial según decisión IA: si IA dijo "incidente válido" sugerimos
  // "Es real"; si dijo "rechazo confiable" sugerimos "No es real".
  const iaSugiereReal     = detail.decision_automatica === "INCIDENTE_VALIDO"
  const iaSugiereDescarte = detail.decision_automatica === "RECHAZO_CONFIABLE"

  const handleDescartar = async () => {
    if (!motivo.trim()) {
      setError("Debes indicar por qué se descarta el reporte.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await cambiarEstado(detail.id, "RECHAZADA", motivo.trim())
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descartar.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
      {/* Imagen grande */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
        {imageUrl ? (
          <img src={imageUrl} alt="Incidente" className="aspect-[4/3] h-full w-full object-contain" />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-sm text-slate-300">
            Sin imagen disponible
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: status.bg, color: status.text }}>
            {detail.estado.replace("_", " ")}
          </span>
          {decision && (
            <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: decision.bg, color: decision.text }}>
              IA: {decision.label}
            </span>
          )}
          <span className="text-xs text-slate-500" title="Confianza del modelo en su decisión">
            Confianza IA {fmtPercent(detail.confianza_decision ?? detail.confianza)}
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
              <div className="mt-1 text-xs text-slate-600">Pasa a clasificar y asignar al equipo.</div>
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
              <div className="mt-1 text-xs text-slate-600">Rechaza el reporte con un motivo escrito.</div>
              {iaSugiereDescarte && <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600">Sugerido por IA</div>}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <label className="text-xs font-bold uppercase tracking-wider text-red-700">
              Motivo de descarte
            </label>
            <textarea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Explica brevemente por qué no procede este reporte."
              className="mt-2 w-full rounded-lg border border-red-200 bg-white p-2 text-sm outline-none focus:border-red-400"
            />
            {error && <div className="mt-2 text-xs font-semibold text-red-700">{error}</div>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setDiscarding(false); setMotivo(""); setError(null) }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
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
