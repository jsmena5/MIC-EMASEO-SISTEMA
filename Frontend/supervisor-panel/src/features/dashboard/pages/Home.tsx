import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getStoredUser } from "../../auth/authSession"
import { getIncidents, type IncidentListItem } from "../../../services/incident.service"

const todayIso = () => new Date().toISOString().slice(0, 10)

const PRIORITY_COLOR: Record<string, string> = {
  CRITICA: "#DC2626",
  ALTA: "#EA580C",
  MEDIA: "#CA8A04",
  BAJA: "#16A34A",
}

function fmtTime(value: string) {
  const d = new Date(value)
  const diff = Date.now() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "hace instantes"
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  return d.toLocaleDateString("es-EC", { day: "2-digit", month: "short" })
}

interface Kpi {
  label: string
  value: number
  hint: string
  href: string
  accent: string
}

interface State {
  loading: boolean
  pendientes: number
  enRevision: number
  asignadosHoy: number
  resueltosHoy: number
  criticos: IncidentListItem[]
  error: string | null
}

const initial: State = {
  loading: true,
  pendientes: 0,
  enRevision: 0,
  asignadosHoy: 0,
  resueltosHoy: 0,
  criticos: [],
  error: null,
}

export default function Home() {
  const user = getStoredUser()
  const [state, setState] = useState<State>(initial)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches"
  const dateLabel = new Date().toLocaleDateString("es-EC", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  })

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const today = todayIso()
        const [pend, rev, asig, res, crit] = await Promise.all([
          getIncidents({ estado: "PENDIENTE",   limit: 1, page: 1 }),
          getIncidents({ estado: "EN_REVISION", limit: 1, page: 1 }),
          getIncidents({ estado: "EN_ATENCION", limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ estado: "RESUELTA",    limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ prioridad: "CRITICA",  limit: 5, page: 1, sort: "priority" }),
        ])
        if (!alive) return
        setState({
          loading: false,
          pendientes:   pend.pagination.total,
          enRevision:   rev.pagination.total,
          asignadosHoy: asig.pagination.total,
          resueltosHoy: res.pagination.total,
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

  const kpis: Kpi[] = [
    { label: "Pendientes",      value: state.pendientes,   hint: "Casos por revisar",         href: "/dashboard/incidencias?estado=PENDIENTE",   accent: "#005BAC" },
    { label: "En revisión IA",  value: state.enRevision,   hint: "Esperan tu validación",     href: "/dashboard/incidencias?estado=EN_REVISION", accent: "#C2410C" },
    { label: "Asignados hoy",   value: state.asignadosHoy, hint: "Despachados al campo",      href: "/dashboard/incidencias?estado=EN_ATENCION", accent: "#6D28D9" },
    { label: "Resueltos hoy",   value: state.resueltosHoy, hint: "Cerrados en este turno",    href: "/dashboard/incidencias?estado=RESUELTA",    accent: "#16A34A" },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{greeting}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{user?.nombre ?? "Supervisor"}</h2>
        <p className="mt-1 text-sm capitalize text-slate-500">{dateLabel}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            to={k.href}
            className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: k.accent }}
              />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 group-hover:text-slate-500">
                Ver
              </span>
            </div>
            <div className="mt-3 text-3xl font-black text-slate-900 tabular-nums">
              {state.loading ? "—" : k.value}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-700">{k.label}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{k.hint}</div>
          </Link>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to="/dashboard/incidencias"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300"
        >
          <div>
            <div className="text-sm font-bold text-slate-900">Bandeja completa</div>
            <div className="text-xs text-slate-500">Filtra, prioriza y resuelve cada caso.</div>
          </div>
          <span className="text-slate-400">→</span>
        </Link>
        <Link
          to="/dashboard/mapa"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300"
        >
          <div>
            <div className="text-sm font-bold text-slate-900">Mapa operativo</div>
            <div className="text-xs text-slate-500">Distribución territorial de incidencias.</div>
          </div>
          <span className="text-slate-400">→</span>
        </Link>
      </div>

      {/* Top críticos */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Casos críticos</div>
            <div className="text-xs text-slate-500">Top 5 por prioridad — toca para abrir.</div>
          </div>
          <Link to="/dashboard/incidencias?prioridad=CRITICA" className="text-xs font-bold text-[#005BAC] hover:underline">
            Ver todos
          </Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {state.loading && (
            <li className="px-5 py-4 text-xs text-slate-500">Cargando casos…</li>
          )}
          {!state.loading && state.criticos.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-500">Sin casos críticos en este momento.</li>
          )}
          {state.criticos.map((c) => (
            <li key={c.id}>
              <Link
                to={`/dashboard/incidencias?id=${c.id}`}
                className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: PRIORITY_COLOR[c.prioridad ?? "BAJA"] }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">
                    {c.zona_nombre ?? "Zona sin definir"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.ciudadano_nombre ?? "Ciudadano no disponible"} · {fmtTime(c.created_at)}
                  </div>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.estado.replace("_", " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {state.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          No se pudo cargar el dashboard: {state.error}
        </div>
      )}
    </div>
  )
}
