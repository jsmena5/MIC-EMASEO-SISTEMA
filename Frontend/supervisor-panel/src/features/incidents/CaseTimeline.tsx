import type { IncidentDetail } from "../../services/incident.service"
import { fmtDate } from "./styles"

export default function CaseTimeline({ detail }: { detail: IncidentDetail }) {
  type Entry = { title: string; subtitle: string; meta: string; note: string | null }

  const historial: Entry[] = detail.historial.map((h) => ({
    title:    `${h.estado_anterior} → ${h.estado_nuevo}`,
    subtitle: `${h.actor} · ${h.actor_rol}`,
    meta:     fmtDate(h.created_at),
    note:     h.observaciones,
  }))

  const asignaciones: Entry[] = detail.asignaciones.map((a) => ({
    title:    a.operario_nombre,
    subtitle: a.completada ? "Asignación completada" : "Asignación activa",
    meta:     fmtDate(a.created_at),
    note:     a.notas,
  }))

  const feedback: Entry[] = detail.feedback_ia.detalle.map((f) => ({
    title:    f.es_correcta ? "Feedback: IA correcta" : "Feedback: IA incorrecta",
    subtitle: `${f.reportado_por_username} · ${f.reportado_por_rol}`,
    meta:     fmtDate(f.created_at),
    note:     f.comentario,
  }))

  const all = [...historial, ...asignaciones, ...feedback].sort((a, b) =>
    b.meta.localeCompare(a.meta),
  )

  if (all.length === 0) {
    return <div className="text-xs text-slate-500">Sin actividad registrada.</div>
  }

  return (
    <ul className="grid gap-2">
      {all.map((e, i) => (
        <li key={i} className="grid grid-cols-[8px_1fr] gap-3">
          <div className="mt-1.5 h-2 w-2 rounded-full bg-[#005BAC]" />
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-900">{e.title}</div>
              <div className="text-[10px] text-slate-500">{e.meta}</div>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">{e.subtitle}</div>
            {e.note && <div className="mt-1 text-xs text-slate-700">{e.note}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}
