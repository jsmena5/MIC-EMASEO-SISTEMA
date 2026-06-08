/**
 * IncidentRail — lista de incidencias (panel izquierdo).
 * Cards compactas inspiradas en Linear: thumbnail cuadrado, título, estado, 1 línea de meta.
 * Sin clutter de múltiples badges apilados.
 */
import type { IncidentListItem, SortOrder } from "../../services/incident.service"
import { toPublicMediaUrl } from "../../shared/api/mediaUrl"
import { ESTADO_STYLE, PRIORIDAD_STYLE, fmtDate, fmtPercent, palette } from "./styles"

function buildImageUrl(item: Pick<IncidentListItem, "image_url" | "imagen_auditoria_url">) {
  return toPublicMediaUrl(item.image_url ?? item.imagen_auditoria_url)
}

export default function IncidentRail({
  incidents, selectedId, onSelect, loading, error, onRetry, sort, onSortChange,
}: {
  incidents: IncidentListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
  error: string | null
  onRetry: () => void
  sort: SortOrder
  onSortChange: (s: SortOrder) => void
}) {
  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Header de la bandeja */}
      <div className="flex items-center justify-between px-2 pb-2 pt-1 shrink-0">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Bandeja</span>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[11px]">
          {(["priority", "newest"] as SortOrder[]).map((s) => (
            <button key={s} onClick={() => onSortChange(s)}
              className={["px-2.5 py-1 font-semibold transition",
                sort === s ? "bg-[#005BAC] text-white" : "bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}>
              {s === "priority" ? "Prioridad" : "Reciente"}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden rounded-xl border border-slate-200 bg-white">
        {loading && (
          <div className="p-6 text-center text-xs text-slate-400">Cargando casos…</div>
        )}
        {error && !loading && (
          <div className="p-6 text-center">
            <p className="text-xs font-semibold text-red-600">{error}</p>
            <button onClick={onRetry} className="mt-2 text-xs font-bold text-[#005BAC] hover:underline">Reintentar</button>
          </div>
        )}
        {!loading && !error && incidents.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-400">Sin casos con esos filtros.</div>
        )}

        <ul>
          {incidents.map((c, idx) => {
            const imageUrl = buildImageUrl(c)
            const status   = ESTADO_STYLE[c.estado] ?? { bg: "#E2E8F0", text: palette.muted }
            const priority = c.prioridad ? PRIORIDAD_STYLE[c.prioridad] : null
            const isSel    = selectedId === c.id
            const confidence = c.confianza_decision ?? c.confianza

            return (
              <li key={c.id} className={idx > 0 ? "border-t border-slate-100" : ""}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={[
                    "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                    isSel ? "bg-blue-50" : "hover:bg-slate-50",
                  ].join(" ")}
                >
                  {/* Thumbnail cuadrado */}
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {imageUrl
                      ? <img src={imageUrl} alt="" className="h-full w-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
                      : <div className="h-full w-full flex items-center justify-center text-[9px] text-slate-400">Sin foto</div>
                    }
                  </div>

                  {/* Contenido */}
                  <div className="min-w-0 flex-1">
                    {/* Fila 1: zona + estado */}
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-[13px] font-semibold text-slate-900 leading-tight truncate">
                        {c.zona_nombre ?? "Zona sin definir"}
                      </span>
                      <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-tight"
                        style={{ background: status.bg, color: status.text }}>
                        {c.estado.replace("_", " ")}
                      </span>
                    </div>

                    {/* Fila 2: prioridad + fecha */}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                      {priority && (
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: priority.dot }} />
                      )}
                      <span className="truncate">{fmtDate(c.created_at)}</span>
                    </div>

                    {/* Fila 3: ID + confianza IA */}
                    <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400">
                      <span className="font-mono">#{c.id.slice(0, 7)}</span>
                      {confidence != null && (
                        <span className={["font-semibold", isSel ? "text-[#005BAC]" : ""].join(" ")}>
                          IA {fmtPercent(confidence)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Indicador de selección */}
                  {isSel && (
                    <div className="self-stretch w-0.5 -mr-3 rounded-r-full bg-[#005BAC] shrink-0" />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
