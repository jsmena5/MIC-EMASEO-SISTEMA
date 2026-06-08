/**
 * IncidentPreview — panel derecho de la bandeja.
 * Muestra imagen grande + metadatos + botones de acción.
 * No tiene formularios — estos van en ReviewModal.
 */
import { useState } from "react"
import type { IncidentDetail } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import { ESTADO_STYLE, NIVEL_LABEL, PRIORIDAD_STYLE, TIPO_LABEL, fmtDate, fmtPercent, fmtVolume } from "./styles"

export default function IncidentPreview({
  detail,
  onReview,
  onReject,
}: {
  detail: IncidentDetail
  onReview: () => void
  onReject: () => void
}) {
  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const status = ESTADO_STYLE[detail.estado] ?? { bg: "#E2E8F0", text: "#475569" }
  const priority = detail.prioridad ? PRIORIDAD_STYLE[detail.prioridad] : null

  const isTerminal = ["RESUELTA", "RECHAZADA", "DESCARTADO", "FALLIDO"].includes(detail.estado)
  const isRevisado = detail.estado === "REVISADO"
  const canReview  = !isTerminal && !isRevisado

  return (
    <div className="flex h-full flex-col gap-0">

      {/* ── Header compacto ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              #{detail.id.slice(0, 8)}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
              style={{ background: status.bg, color: status.text }}>
              {detail.estado.replace(/_/g, " ")}
            </span>
            {priority && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: priority.dot }} />
                {priority.label}
              </span>
            )}
          </div>
          <h2 className="mt-0.5 text-lg font-extrabold text-slate-900 leading-tight truncate">
            {detail.zona_nombre ?? "Zona sin definir"}
          </h2>
          <p className="text-xs text-slate-500">
            {detail.ciudadano_nombre ?? "Ciudadano"} · {fmtDate(detail.created_at)}
          </p>
        </div>

        {/* Botones de acción principales */}
        {canReview && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onReject}
              className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 transition"
            >
              Rechazar
            </button>
            <button
              onClick={onReview}
              className="rounded-xl bg-[#005BAC] px-4 py-2 text-sm font-bold text-white hover:bg-[#004B8E] transition"
            >
              Revisar incidencia →
            </button>
          </div>
        )}
        {isRevisado && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700">
              ✓ Revisado
            </span>
            <button
              onClick={onReview}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
            >
              Editar revisión
            </button>
          </div>
        )}
      </div>

      {/* ── Imagen grande ──────────────────────────────────────── */}
      <div className="flex-1 min-h-0 bg-slate-950 relative">
        {imageUrl ? (
          <>
            <button
              type="button"
              className="h-full w-full cursor-zoom-in"
              onClick={() => setLightboxOpen(true)}
              title="Click para ver en grande"
            >
              <img
                src={imageUrl}
                alt="Incidente"
                className="h-full w-full object-contain"
              />
            </button>
            <div className="absolute bottom-3 right-3 rounded-lg bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
              Click para ampliar
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Sin imagen disponible
          </div>
        )}
      </div>

      {/* ── Strip de datos ─────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-2 gap-px bg-slate-100 border-t border-slate-100">
        <Cell label="Confianza IA" value={fmtPercent(detail.confianza_decision ?? detail.confianza)} />
        <Cell label="Tipo residuo" value={detail.tipo_residuo ? TIPO_LABEL[detail.tipo_residuo] : "—"} />
        <Cell label="Acumulación"  value={detail.nivel_acumulacion ? NIVEL_LABEL[detail.nivel_acumulacion] : "—"} />
        <Cell label="Volumen est."  value={fmtVolume(detail.volumen_estimado_m3)} />
        <Cell label="Ciudadano"    value={detail.ciudadano_nombre ?? "—"} />
        <Cell label="Correo"       value={detail.ciudadano_email ?? "—"} />
      </div>

      {/* Lightbox */}
      {lightboxOpen && imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 text-lg"
            onClick={() => setLightboxOpen(false)}
          >
            ✕
          </button>
          <img
            src={imageUrl}
            alt="Incidente ampliado"
            className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold text-slate-800">{value}</div>
    </div>
  )
}
