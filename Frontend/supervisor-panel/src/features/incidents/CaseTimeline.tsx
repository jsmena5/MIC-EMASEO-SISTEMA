import type { IncidentDetail } from "../../services/incident.service"
import { fmtDate } from "./styles"

const SISTEMA_UUID = "00000000-0000-0000-0000-000000000001"

function cleanActor(actor: string | null, rol: string | null): string {
  if (!actor || actor === "null") return "Sistema"
  if (actor === SISTEMA_UUID) return "Sistema"
  const name = actor.includes("-") && actor.length === 36 ? "Sistema" : actor
  if (!rol || rol === "null") return name
  return `${name} · ${rol}`
}

function cleanEstado(raw: string | null): string {
  if (!raw || raw === "null") return "Inicio"
  return raw.replace(/_/g, " ")
}

type Entry = { title: string; subtitle: string; meta: string; note: string | null; dot: string }

export default function CaseTimeline({ detail }: { detail: IncidentDetail }) {
  const historial: Entry[] = detail.historial.map((h) => ({
    title:    `${cleanEstado(h.estado_anterior)} → ${cleanEstado(h.estado_nuevo)}`,
    subtitle: cleanActor(h.actor, h.actor_rol),
    meta:     fmtDate(h.created_at),
    note:     h.observaciones || null,
    dot:      "#005BAC",
  }))

  const feedback: Entry[] = detail.feedback_ia.detalle.map((f) => ({
    title:    f.es_correcta ? "Feedback: IA correcta" : "Feedback: IA incorrecta",
    subtitle: cleanActor(f.reportado_por_username, f.reportado_por_rol),
    meta:     fmtDate(f.created_at),
    note:     f.comentario,
    dot:      f.es_correcta ? "#22C55E" : "#EF4444",
  }))

  const all = [...historial, ...feedback].sort((a, b) => a.meta.localeCompare(b.meta))

  if (all.length === 0) {
    return <div className="text-xs text-slate-400 py-2">Sin actividad registrada.</div>
  }

  return (
    <ul className="relative grid gap-0 pl-4">
      {/* Línea vertical */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" />

      {all.map((e, i) => (
        <li key={i} className="relative grid grid-cols-[1px_1fr] gap-4 pb-4">
          {/* Dot */}
          <div className="relative flex justify-center pt-1">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm z-10"
              style={{ background: e.dot }} />
          </div>

          {/* Contenido */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-1">
              <span className="text-xs font-bold text-slate-900">{e.title}</span>
              <span className="text-[10px] text-slate-400 shrink-0">{e.meta}</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{e.subtitle}</div>
            {e.note && (
              <div className="mt-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-700 italic">
                {e.note}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
