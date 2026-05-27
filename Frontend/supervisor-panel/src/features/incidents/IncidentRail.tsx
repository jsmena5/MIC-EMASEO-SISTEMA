import type { IncidentListItem, SortOrder } from "../../services/incident.service"
import { DECISION_STYLE, ESTADO_STYLE, PRIORIDAD_STYLE, fmtDate, fmtPercent, palette } from "./styles"

function buildImageUrl(item: Pick<IncidentListItem, "image_url" | "imagen_auditoria_url">) {
  return item.image_url ?? item.imagen_auditoria_url
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
    <div className="flex h-full min-w-[260px] max-w-[300px] flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Bandeja</div>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-[11px]">
          {(["priority", "newest"] as SortOrder[]).map((s) => (
            <button
              key={s}
              onClick={() => onSortChange(s)}
              className={[
                "px-2.5 py-1 font-semibold transition",
                sort === s ? "bg-[#005BAC] text-white" : "bg-white text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {s === "priority" ? "Prioridad" : "Reciente"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white p-2">
        {loading && (
          <div className="px-3 py-8 text-center text-xs text-slate-500">Cargando casos…</div>
        )}
        {error && !loading && (
          <div className="px-3 py-6 text-center">
            <div className="text-xs font-semibold text-red-600">{error}</div>
            <button onClick={onRetry} className="mt-2 text-xs font-bold text-[#005BAC] hover:underline">
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && incidents.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-slate-500">No hay casos con esos filtros.</div>
        )}

        <ul className="grid gap-2">
          {incidents.map((c) => {
            const imageUrl = buildImageUrl(c)
            const status   = ESTADO_STYLE[c.estado] ?? { bg: "#E2E8F0", text: palette.muted }
            const priority = c.prioridad ? PRIORIDAD_STYLE[c.prioridad] : null
            const decision = c.decision_automatica ? DECISION_STYLE[c.decision_automatica] : null
            const isSel = selectedId === c.id

            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={[
                    "flex w-full gap-3 rounded-xl border p-2 text-left transition",
                    isSel
                      ? "border-[#005BAC] bg-[#F7FBFF]"
                      : "border-slate-200 bg-white hover:bg-slate-50",
                  ].join(" ")}
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-100 bg-slate-100">
                    {imageUrl
                      ? <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">Sin foto</div>}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-900">#{c.id.slice(0, 8)}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: status.bg, color: status.text }}
                      >
                        {c.estado.replace("_", " ")}
                      </span>
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-800">{c.zona_nombre ?? "Zona sin definir"}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      {priority && (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: priority.dot }} />
                          <span className="font-semibold">{priority.label}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{fmtDate(c.created_at)}</span>
                    </div>
                    {decision && (
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: decision.bg, color: decision.text }}>
                          {decision.label}
                        </span>
                        <span>IA {fmtPercent(c.confianza_decision ?? c.confianza)}</span>
                      </div>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
