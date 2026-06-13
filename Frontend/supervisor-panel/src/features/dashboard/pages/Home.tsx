import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getStoredUser } from "../../auth/authSession"
import { getIncidents, type IncidentListItem } from "../../../services/incident.service"

const todayIso = () => new Date().toISOString().slice(0, 10)

function fmtTime(value: string) {
  const diff = Date.now() - new Date(value).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1)  return "hace instantes"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(value).toLocaleDateString("es-EC", { day: "2-digit", month: "short" })
}

const PRIORITY_DOT: Record<string, string> = {
  CRITICA: "#DC2626", ALTA: "#EA580C", MEDIA: "#CA8A04", BAJA: "#16A34A",
}

interface State {
  loading: boolean
  pendientes:   number
  revisados:    number
  enRevision:   number
  resueltosHoy: number
  recientes:    IncidentListItem[]
  criticos:     IncidentListItem[]
  error: string | null
}

const initial: State = {
  loading: true,
  pendientes: 0, revisados: 0, enRevision: 0, resueltosHoy: 0,
  recientes: [], criticos: [], error: null,
}

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, hint, href, accent, loading }: {
  readonly label: string; value: number; hint: string; href: string; accent: string; loading: boolean
}) {
  return (
    <Link to={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm">
      <div className="flex items-center justify-between">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 group-hover:text-slate-600">Ver →</span>
      </div>
      <div className="mt-3 text-3xl font-black tabular-nums text-slate-900">
        {loading ? <span className="text-slate-300">—</span> : value}
      </div>
      <div className="mt-1 text-xs font-semibold text-slate-700">{label}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
    </Link>
  )
}

// ── Progress bar de distribución ─────────────────────────────────────────────

function StatusBar({ pendientes, revisados, enRevision, resueltosHoy }: {
  readonly pendientes: number; revisados: number; enRevision: number; resueltosHoy: number
}) {
  const total = pendientes + revisados + enRevision + resueltosHoy
  if (total === 0) return null
  const pct = (n: number) => Math.round((n / total) * 100)
  const segments = [
    { label: "Pendientes",  value: pendientes,   color: "#F59E0B", pct: pct(pendientes)   },
    { label: "Revisados",   value: revisados,    color: "#0EA5E9", pct: pct(revisados)    },
    { label: "En rev. IA",  value: enRevision,   color: "#F97316", pct: pct(enRevision)   },
    { label: "Resueltos hoy", value: resueltosHoy, color: "#22C55E", pct: pct(resueltosHoy) },
  ].filter(s => s.value > 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="text-sm font-extrabold text-slate-900 mb-3">Distribución de casos activos</div>
      {/* Barra */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        {segments.map(s => (
          <div key={s.label} title={`${s.label}: ${s.value}`}
            style={{ width: `${s.pct}%`, background: s.color }} />
        ))}
      </div>
      {/* Leyenda */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-slate-600">
              <span className="font-bold">{s.value}</span> {s.label}
            </span>
          </div>
        ))}
        <span className="ml-auto text-xs text-slate-400">{total} totales activos</span>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const user = getStoredUser()
  const [state, setState] = useState<State>(initial)

  const hour = new Date().getHours()
  let greeting: string
  if (hour < 12) greeting = "Buenos días"
  else if (hour < 18) greeting = "Buenas tardes"
  else greeting = "Buenas noches"
  const dateLabel = new Date().toLocaleDateString("es-EC", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const today = todayIso()
        const [pend, rev, enRev, res, rec, crit] = await Promise.all([
          getIncidents({ estado: "PENDIENTE",   limit: 1, page: 1 }),
          getIncidents({ estado: "REVISADO",    limit: 1, page: 1 }),
          getIncidents({ estado: "EN_REVISION", limit: 1, page: 1 }),
          getIncidents({ estado: "RESUELTA",    limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ limit: 6, page: 1, sort: "newest", fecha_desde: today }),
          getIncidents({ prioridad: "CRITICA",  limit: 5, page: 1, sort: "priority" }),
        ])
        if (!alive) return
        setState({
          loading: false,
          pendientes:   pend.pagination.total,
          revisados:    rev.pagination.total,
          enRevision:   enRev.pagination.total,
          resueltosHoy: res.pagination.total,
          recientes:    rec.incidents,
          criticos:     crit.incidents,
          error: null,
        })
      } catch (err) {
        if (!alive) return
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Error" }))
      }
    }
    load()
    const id = setInterval(load, 45_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <div className="flex flex-col gap-5">
      {/* Greeting */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{greeting}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{user?.nombre ?? "Supervisor"}</h2>
        <p className="mt-0.5 text-sm capitalize text-slate-500">{dateLabel}</p>
      </div>

      {/* KPIs — 5 tarjetas: las más importantes para el supervisor */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Por validar"   value={state.pendientes}   hint="Casos sin revisar"         href="/dashboard/incidencias?estado=PENDIENTE&sin_supervisar=false"   accent="#F59E0B" loading={state.loading} />
        <KpiCard label="Revisados"     value={state.revisados}    hint="Clasificados por supervisor" href="/dashboard/incidencias?estado=REVISADO&sin_supervisar=false"    accent="#0EA5E9" loading={state.loading} />
        <KpiCard label="En revisión IA" value={state.enRevision} hint="Esperan tu validación"      href="/dashboard/incidencias?estado=EN_REVISION&sin_supervisar=false" accent="#F97316" loading={state.loading} />
        <KpiCard label="Resueltos hoy" value={state.resueltosHoy} hint="Cerrados en este turno"    href="/dashboard/incidencias?estado=RESUELTA&sin_supervisar=false"    accent="#22C55E" loading={state.loading} />
      </div>

      {/* Barra de distribución */}
      {!state.loading && (
        <StatusBar
          pendientes={state.pendientes}
          revisados={state.revisados}
          enRevision={state.enRevision}
          resueltosHoy={state.resueltosHoy}
        />
      )}

      {/* Incidencias recientes de hoy */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Llegadas hoy</div>
            <div className="text-xs text-slate-500">Incidencias reportadas en las últimas 24 h</div>
          </div>
          <Link to="/dashboard/incidencias" className="text-xs font-bold text-[#005BAC] hover:underline">
            Ver todas →
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {state.loading && (
            <li className="px-5 py-4 text-xs text-slate-400">Cargando…</li>
          )}
          {!state.loading && state.recientes.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-400">Sin incidencias hoy todavía.</li>
          )}
          {state.recientes.map((c) => (
            <li key={c.id}>
              <Link to={`/dashboard/incidencias?id=${c.id}&sin_supervisar=false`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition">
                <span className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: PRIORITY_DOT[c.prioridad ?? "BAJA"] }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {c.zona_nombre ?? "Zona sin definir"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.ciudadano_nombre ?? "Ciudadano"} · {fmtTime(c.created_at)}
                  </div>
                </div>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: c.estado === "PENDIENTE" ? "#FEF3C7" : "#F0FDF4", color: c.estado === "PENDIENTE" ? "#B45309" : "#15803D" }}>
                  {c.estado.replaceAll("_", " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Top críticos */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Casos críticos</div>
            <div className="text-xs text-slate-500">Top 5 por prioridad — requieren atención inmediata</div>
          </div>
          <Link to="/dashboard/incidencias?prioridad=CRITICA&sin_supervisar=false"
            className="text-xs font-bold text-[#005BAC] hover:underline">
            Ver todos →
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {state.loading && <li className="px-5 py-4 text-xs text-slate-400">Cargando…</li>}
          {!state.loading && state.criticos.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-400">Sin casos críticos activos.</li>
          )}
          {state.criticos.map((c) => (
            <li key={c.id}>
              <Link to={`/dashboard/incidencias?id=${c.id}&sin_supervisar=false`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: PRIORITY_DOT[c.prioridad ?? "BAJA"] }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {c.zona_nombre ?? "Zona sin definir"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.ciudadano_nombre ?? "Ciudadano"} · {fmtTime(c.created_at)}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.estado.replace("_", " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link to="/dashboard/incidencias"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 transition">
          <div>
            <div className="text-sm font-bold text-slate-900">Bandeja completa</div>
            <div className="text-xs text-slate-500">Filtra, prioriza y revisa cada caso.</div>
          </div>
          <span className="text-slate-400">→</span>
        </Link>
        <Link to="/dashboard/mapa"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 transition">
          <div>
            <div className="text-sm font-bold text-slate-900">Mapa operativo</div>
            <div className="text-xs text-slate-500">Distribución territorial de incidencias.</div>
          </div>
          <span className="text-slate-400">→</span>
        </Link>
      </div>

      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          No se pudo cargar el dashboard: {state.error}
        </div>
      )}
    </div>
  )
}
