import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { getEstadisticasZonas, getIncidents } from "../../../services/analytics.service"
import type { ZonaStats, IncidentListItem } from "../../../services/analytics.service"
import { getStoredUser } from "../../auth/authSession"

function fmtTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1)  return "hace instantes"
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short" })
}

const PRIORITY_COLOR: Record<string, string> = {
  CRITICA: "#DC2626", ALTA: "#EA580C", MEDIA: "#CA8A04", BAJA: "#16A34A",
}

const ESTADO_COLOR: Record<string, string> = {
  PENDIENTE: "#2563EB", EN_ATENCION: "#D97706", RESUELTA: "#16A34A",
  RECHAZADA: "#DC2626", EN_REVISION: "#7C3AED", DESCARTADO: "#9CA3AF", PROCESANDO: "#6B7280",
}

interface KpiState {
  loading: boolean
  pendientes:   number
  revisados:    number
  enRevision:   number
  asignadosHoy: number
  resueltosHoy: number
  criticos:     IncidentListItem[]
  error: string | null
}

const todayIso = () => new Date().toISOString().slice(0, 10)

export default function Home() {
  const user = getStoredUser()
  const [kpi, setKpi] = useState<KpiState>({
    loading: true, pendientes: 0, revisados: 0, enRevision: 0,
    asignadosHoy: 0, resueltosHoy: 0, criticos: [], error: null,
  })
  const [zonas, setZonas] = useState<ZonaStats[]>([])
  const [zonasLoading, setZonasLoading] = useState(true)

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
        const [pend, revisado, rev, asig, res, crit] = await Promise.all([
          getIncidents({ estado: "PENDIENTE",   limit: 1, page: 1 }),
          getIncidents({ estado: "REVISADO",    limit: 1, page: 1 }),
          getIncidents({ estado: "EN_REVISION", limit: 1, page: 1 }),
          getIncidents({ estado: "EN_ATENCION", limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ estado: "RESUELTA",    limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ prioridad: "CRITICA",  limit: 5, page: 1, sort: "priority" }),
        ])
        if (!alive) return
        setKpi({
          loading: false,
          pendientes:   pend.pagination.total,
          revisados:    revisado.pagination.total,
          enRevision:   rev.pagination.total,
          asignadosHoy: asig.pagination.total,
          resueltosHoy: res.pagination.total,
          criticos:     crit.incidents,
          error:        null,
        })
      } catch (err) {
        if (!alive) return
        setKpi((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Error" }))
      }
    }
    load()
    const id = setInterval(load, 45_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    let alive = true
    getEstadisticasZonas()
      .then(({ zonas: z }) => { if (alive) { setZonas(z); setZonasLoading(false) } })
      .catch(() => { if (alive) setZonasLoading(false) })
    return () => { alive = false }
  }, [])

  const kpis = [
    { label: "Pendientes",      value: kpi.pendientes,   hint: "Sin revisar",           accent: "#F59E0B" },
    { label: "Revisados",       value: kpi.revisados,    hint: "Validados por supervisor", accent: "#0EA5E9" },
    { label: "En revisión IA",  value: kpi.enRevision,   hint: "Ambiguos, esperan",     accent: "#F97316" },
    { label: "Resueltos hoy",   value: kpi.resueltosHoy, hint: "Cerrados en el día",    accent: "#16A34A" },
  ]

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{greeting}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{user?.nombre ?? "Administrador"}</h2>
        <p className="mt-1 text-sm capitalize text-slate-500">{dateLabel}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <span className="h-2.5 w-2.5 rounded-full block" style={{ background: k.accent }} />
            <div className="mt-3 text-3xl font-black text-slate-900 tabular-nums">
              {kpi.loading ? <span className="text-slate-300">—</span> : k.value}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-700">{k.label}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{k.hint}</div>
          </div>
        ))}
      </div>

      {/* Barra de distribución de estados */}
      {!kpi.loading && (kpi.pendientes + kpi.revisados + kpi.enRevision + kpi.resueltosHoy) > 0 && (() => {
        const total = kpi.pendientes + kpi.revisados + kpi.enRevision + kpi.resueltosHoy
        const segs = [
          { label: "Pendientes", value: kpi.pendientes,   color: "#F59E0B" },
          { label: "Revisados",  value: kpi.revisados,    color: "#0EA5E9" },
          { label: "En rev. IA", value: kpi.enRevision,   color: "#F97316" },
          { label: "Resueltos",  value: kpi.resueltosHoy, color: "#22C55E" },
        ].filter(s => s.value > 0)
        return (
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-extrabold text-slate-900 mb-3">Distribución de casos activos</div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
              {segs.map(s => (
                <div key={s.label} title={`${s.label}: ${s.value}`}
                  style={{ width: `${Math.round((s.value/total)*100)}%`, background: s.color }} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {segs.map(s => (
                <div key={s.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span className="text-xs text-slate-600"><span className="font-bold">{s.value}</span> {s.label}</span>
                </div>
              ))}
              <span className="ml-auto text-xs text-slate-400">{total} activos</span>
            </div>
          </div>
        )
      })()}

      {/* Quick access */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { to: "/dashboard/supervisores", title: "Supervisores", desc: "Crear, editar y desactivar supervisores" },
          { to: "/dashboard/zonas",        title: "Zonas",        desc: "Importar GeoJSON y asignar supervisores" },
          { to: "/dashboard/configuracion", title: "Configuración", desc: "Parámetros del sistema y geocerca" },
        ].map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-indigo-200 hover:bg-indigo-50/30 transition"
          >
            <div>
              <div className="text-sm font-bold text-slate-900">{item.title}</div>
              <div className="text-xs text-slate-500">{item.desc}</div>
            </div>
            <span className="text-slate-400">→</span>
          </Link>
        ))}
      </div>

      {/* Zonas table */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Estadísticas por zona</div>
            <div className="text-xs text-slate-500">Últimos 30 días</div>
          </div>
          <Link to="/dashboard/zonas" className="text-xs font-bold text-indigo-600 hover:underline">
            Gestionar →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {["Zona", "Supervisor", "Total", "Pend.", "En atención", "Resueltos", "Críticos"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {zonasLoading && (
                <tr><td colSpan={7} className="px-4 py-4 text-xs text-slate-400">Cargando…</td></tr>
              )}
              {!zonasLoading && zonas.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-4 text-xs text-slate-400">Sin datos</td></tr>
              )}
              {zonas.map((z) => (
                <tr key={z.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-semibold text-slate-900">{z.nombre}</td>
                  <td className="px-4 py-3 text-slate-600">{z.supervisor_nombre ?? <span className="text-slate-400 italic">Sin asignar</span>}</td>
                  <td className="px-4 py-3 font-bold tabular-nums">{z.total}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                      {z.pendientes}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      {z.en_atencion}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      {z.resueltas}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {z.criticas > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                        {z.criticas}
                      </span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top críticos */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="text-sm font-extrabold text-slate-900">Casos críticos recientes</div>
          <div className="text-xs text-slate-500">Prioridad CRITICA — top 5</div>
        </div>
        <ul className="divide-y divide-slate-100">
          {kpi.loading && (
            <li className="px-5 py-4 text-xs text-slate-400">Cargando…</li>
          )}
          {!kpi.loading && kpi.criticos.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-400">Sin casos críticos en este momento.</li>
          )}
          {kpi.criticos.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: PRIORITY_COLOR[c.prioridad ?? "BAJA"] }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {c.zona_nombre ?? "Zona sin definir"}
                </div>
                <div className="text-xs text-slate-500">
                  {c.ciudadano_nombre ?? "Ciudadano"} · {fmtTime(c.created_at)}
                </div>
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                style={{ background: ESTADO_COLOR[c.estado] + "18", color: ESTADO_COLOR[c.estado] }}
              >
                {c.estado.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {kpi.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          Error al cargar el dashboard: {kpi.error}
        </div>
      )}
    </div>
  )
}
