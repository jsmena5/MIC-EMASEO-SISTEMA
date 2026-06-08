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
}: {
  detail: IncidentDetail
  onReview: () => void
  onReject: () => void
}) {
  const imageUrl  = toPublicMediaUrl(detail.image_url ?? detail.imagen_auditoria_url)
  const hasCoords = detail.latitud != null && detail.longitud != null
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const status   = ESTADO_STYLE[detail.estado] ?? { bg: "#E2E8F0", text: "#475569" }
  const priority = detail.prioridad ? PRIORIDAD_STYLE[detail.prioridad] : null

  const isTerminal = ["RESUELTA", "RECHAZADA", "DESCARTADO", "FALLIDO"].includes(detail.estado)
  const isRevisado = detail.estado === "REVISADO"
  const canReview  = !isTerminal && !isRevisado

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        {/* Fila 1: ID + badges */}
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-[11px] font-mono font-semibold text-slate-400">#{detail.id.slice(0, 8)}</span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: status.bg, color: status.text }}>
            {detail.estado.replace(/_/g, " ")}
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
          {isRevisado && (
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700">✓ Revisado</span>
              <button onClick={onReview}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition">
                Editar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Imagen + mini mapa lado a lado ───────────────────────
           La imagen usa object-cover centrado para eliminar las bandas negras.
           El mapa embebido (OpenStreetMap, sin API key) ocupa el espacio sobrante. ── */}
      {/* Tablet/desktop: imagen + mapa lado a lado.
          Mobile (<640px): imagen arriba (3:2), mapa abajo (120px). */}
      <div className={[
        "bg-slate-950",
        hasCoords ? "grid sm:grid-cols-[1fr_200px]" : "",
      ].join(" ")}
        style={{ minHeight: 220 }}
      >
        {/* Imagen */}
        {imageUrl ? (
          <div className="relative overflow-hidden" style={{ minHeight: 200 }}>
            <button
              type="button"
              className="block h-full w-full cursor-zoom-in"
              onClick={() => setLightboxOpen(true)}
              title="Click para ampliar"
            >
              {/* Desktop/tablet: altura fija 42vh. Mobile: aspect 4/3 para que se vea bien en vertical */}
              <img
                src={imageUrl}
                alt="Incidente"
                className="aspect-[4/3] w-full object-cover object-center sm:aspect-auto sm:h-[42vh]"
              />
            </button>
            <span className="absolute bottom-2 right-2 rounded-md bg-black/50 px-2 py-0.5 text-[10px] text-white">
              🔍 Ampliar
            </span>
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-sm text-slate-500 sm:h-[42vh] sm:aspect-auto">
            Sin imagen
          </div>
        )}

        {/* Mini mapa OpenStreetMap — desktop: columna derecha; mobile: franja debajo */}
        {hasCoords && (
          <div className="relative overflow-hidden border-t border-slate-800 sm:border-t-0 sm:border-l" style={{ minHeight: 140 }}>
            <iframe
              title="Ubicación del incidente"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${detail.longitud - 0.004},${detail.latitud - 0.003},${detail.longitud + 0.004},${detail.latitud + 0.003}&layer=mapnik&marker=${detail.latitud},${detail.longitud}`}
              className="h-full w-full"
              style={{ minHeight: 140, border: 0, filter: "saturate(0.9)" }}
              loading="lazy"
            />
            <a
              href={`https://www.openstreetmap.org/?mlat=${detail.latitud}&mlon=${detail.longitud}#map=17/${detail.latitud}/${detail.longitud}`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-white shadow whitespace-nowrap"
            >
              <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              Ver mapa
            </a>
          </div>
        )}
      </div>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}>
          <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white text-xl"
            onClick={() => setLightboxOpen(false)}>✕</button>
          <img src={imageUrl} alt="ampliado"
            className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

function DataCell({ label, value, highlight, small }: {
  label: string; value: string; highlight?: boolean; small?: boolean
}) {
  return (
    <div className="bg-white px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={["mt-0.5 font-semibold truncate", small ? "text-[11px]" : "text-xs", highlight ? "text-[#005BAC]" : "text-slate-800"].join(" ")}>
        {value}
      </div>
    </div>
  )
}
