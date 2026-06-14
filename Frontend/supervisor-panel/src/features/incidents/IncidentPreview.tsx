/**
 * IncidentPreview — panel derecho de la bandeja.
 * Imagen con aspect-ratio fijo (sin bandas negras), datos compactos, botones de acción.
 * Diseño inspirado en Linear: jerarquía clara, sin clutter.
 */
import { useState } from "react"
import type { IncidentDetail } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import { ESTADO_STYLE, NIVEL_LABEL, PRIORIDAD_STYLE, TIPO_LABEL, fmtDate, fmtPercent, fmtVolume } from "./styles"

export default function IncidentPreview({
  detail,
  onReview,
  onReject,
}: Readonly<{
  detail: IncidentDetail
  onReview: () => void
  onReject: () => void
}>) {
  const imageUrl = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const status   = ESTADO_STYLE[detail.estado] ?? { bg: "#E2E8F0", text: "#475569" }
  const priority = detail.prioridad ? PRIORIDAD_STYLE[detail.prioridad] : null

  const isTerminal = ["RESUELTA", "RECHAZADO", "DESCARTADO", "FALLIDO"].includes(detail.estado)
  const canReview  = !isTerminal

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        {/* Fila 1: ID + badges */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[11px] font-mono font-semibold text-slate-400">#{detail.id.slice(0, 8)}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: status.bg, color: status.text }}>
            {(ESTADO_STYLE[detail.estado]?.label ?? detail.estado.replaceAll("_", " "))}
          </span>
          {priority && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="h-2 w-2 rounded-full" style={{ background: priority.dot }} />
              {priority.label}
            </span>
          )}
        </div>
        {/* Fila 2: Título */}
        <h2 className="text-xl font-extrabold text-slate-900 leading-tight">
          {detail.zona_nombre ?? "Zona sin definir"}
        </h2>
        {/* Fila 3: meta + acciones */}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {detail.ciudadano_nombre ?? "Ciudadano"} · {fmtDate(detail.created_at)}
          </span>
          {canReview && (
            <div className="flex items-center gap-2">
              <button onClick={onReject}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 transition">
                Rechazar
              </button>
              <button onClick={onReview}
                className="rounded-lg bg-[#005BAC] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#004B8E] transition">
                Revisar →
              </button>
            </div>
          )}
          {detail.estado === "VALIDO" && (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700">✓ Válido</span>
              <button onClick={onReview}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition">
                Editar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Imagen — altura máxima 45vh, object-contain, sin bandas de overflow ── */}
      {imageUrl ? (
        <div className="relative bg-slate-950">
          <button
            type="button"
            className="block w-full cursor-zoom-in"
            onClick={() => setLightboxOpen(true)}
            title="Click para ampliar"
          >
            <img
              src={imageUrl}
              alt="Incidente"
              className="max-h-[45vh] w-full object-contain"
            />
          </button>
          <span className="absolute bottom-2 right-2 rounded-md bg-black/50 px-2 py-0.5 text-[10px] text-white">
            🔍 Ampliar
          </span>
        </div>
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-slate-100 text-sm text-slate-400">
          Sin imagen
        </div>
      )}

      {/* ── Datos IA en grid limpio ────────────────────────────── */}
      <div className="grid grid-cols-3 gap-px bg-slate-100 border-y border-slate-100">
        <DataCell label="Confianza IA" value={fmtPercent(detail.confianza_decision ?? detail.confianza)} highlight />
        <DataCell label="Tipo residuo" value={detail.tipo_residuo ? TIPO_LABEL[detail.tipo_residuo] : "—"} />
        <DataCell label="Acumulación"  value={detail.nivel_acumulacion ? NIVEL_LABEL[detail.nivel_acumulacion] : "—"} />
        <DataCell label="Volumen est."  value={fmtVolume(detail.volumen_estimado_m3)} />
        <DataCell label="Detecciones"  value={String(detail.num_detecciones ?? 0)} />
        <DataCell label="Correo"       value={detail.ciudadano_email ?? "—"} small />
      </div>

      {/* Lightbox */}
      {lightboxOpen && imageUrl && (
        <div aria-hidden="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}>
          <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white text-xl"
            onClick={() => setLightboxOpen(false)}>✕</button>
          <img src={imageUrl} alt="ampliado"
            className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain" />
        </div>
      )}
    </>
  )
}

function DataCell({ label, value, highlight, small }: Readonly<{
  label: string; value: string; highlight?: boolean; small?: boolean
}>) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={["mt-0.5 font-semibold truncate", small ? "text-[11px]" : "text-xs", highlight ? "text-[#005BAC]" : "text-slate-800"].join(" ")}>
        {value}
      </div>
    </div>
  )
}
