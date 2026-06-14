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

function isoDay(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function shortDay(isoDate: string): string {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("es-EC", { weekday: "short", day: "numeric" })
}

const PRIORITY_DOT: Record<string, string> = {
  CRITICA: "#DC2626", ALTA: "#EA580C", MEDIA: "#CA8A04", BAJA: "#16A34A",
}

// ── Sub-componentes de gráficas ───────────────────────────────────────────────

function DonutChart({ segments, size = 110 }: Readonly<{
  segments: { value: number; color: string; label: string }[]
  size?: number
}>) {
  const total = segments.reduce((s, g) => s + g.value, 0)
  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E2E8F0" strokeWidth="3.8" />
      </svg>
    )
  }
  const circumference = 2 * Math.PI * 15.9
  let accumulated = 0
  const arcs = segments.map(seg => {
    const pct = seg.value / total
    const offset = circumference * (1 - accumulated)
    const dash = circumference * pct
    accumulated += pct
    return { ...seg, dash, offset }
  })
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
      {arcs.map((arc, i) => (
        <circle key={i} cx="18" cy="18" r="15.9" fill="none"
          stroke={arc.color} strokeWidth="3.8"
          strokeDasharray={`${arc.dash} ${circumference}`}
          strokeDashoffset={arc.offset} />
      ))}
    </svg>
  )
}

function HBar({ label, value, max, color }: Readonly<{ label: string; value: number; max: number; color: string }>) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700 truncate max-w-[160px]">{label}</span>
        <span className="font-bold tabular-nums text-slate-900 ml-2">{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function WeeklyBar({ days, max }: Readonly<{ days: { date: string; label: string; count: number }[]; max: number }>) {
  return (
    <div className="flex items-end justify-between gap-1 h-24">
      {days.map(d => {
        const h = max > 0 ? Math.round((d.count / max) * 100) : 0
        return (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-bold tabular-nums text-slate-600">{d.count > 0 ? d.count : ""}</span>
            <div className="w-full rounded-t-lg transition-all duration-500"
              style={{ height: `${Math.max(h, 3)}%`, background: "#005BAC", opacity: d.count === 0 ? 0.15 : 1 }} />
            <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function KpiCard({ label, value, hint, href, accent, loading }: Readonly<{
  label: string; value: number; hint: string; href: string; accent: string; loading: boolean
}>) {
  return (
    <Link to={href} className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm">
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

function MetricBlock({ label, value, hint }: Readonly<{ label: string; value: string; hint: string }>) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-black text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
    </div>
  )
}

// ── Estado de datos ───────────────────────────────────────────────────────────

interface HomeState {
  loading: boolean
  // KPIs
  entrantes: number
  validos: number
  enAtencion: number
  rechazados: number
  descartados: number
  resueltas: number
  resueltosHoy: number
  // Listas
  recientes: IncidentListItem[]
  criticos: IncidentListItem[]
  // Gráficas
  weeklyTrend: { date: string; label: string; count: number }[]
  zonas: { nombre: string; total: number }[]
  critica: number
  alta: number
  media: number
  baja: number
  error: string | null
}

const initial: HomeState = {
  loading: true,
  entrantes: 0, validos: 0, enAtencion: 0, rechazados: 0, descartados: 0, resueltas: 0, resueltosHoy: 0,
  recientes: [], criticos: [],
  weeklyTrend: [], zonas: [],
  critica: 0, alta: 0, media: 0, baja: 0,
  error: null,
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Home() {
  const user = getStoredUser()
  const [state, setState] = useState<HomeState>(initial)

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
        const days = Array.from({ length: 7 }, (_, i) => isoDay(i - 6))

        const [
          procesando, pendiente, validos, enAtencion, rechazados, descartados, fallidos, resueltas, resueltosHoy,
          critica, alta, media, baja,
          recientes, criticos,
          allRecent,
          ...weekResults
        ] = await Promise.all([
          getIncidents({ estado: "PROCESANDO",  limit: 1, page: 1 }),
          getIncidents({ estado: "PENDIENTE",   limit: 1, page: 1 }),
          getIncidents({ estado: "VALIDO",      limit: 1, page: 1 }),
          getIncidents({ estado: "EN_ATENCION", limit: 1, page: 1 }),
          getIncidents({ estado: "RECHAZADO",   limit: 1, page: 1 }),
          getIncidents({ estado: "DESCARTADO",  limit: 1, page: 1 }),
          getIncidents({ estado: "FALLIDO",     limit: 1, page: 1 }),
          getIncidents({ estado: "RESUELTA",    limit: 1, page: 1 }),
          getIncidents({ estado: "RESUELTA",    limit: 1, page: 1, fecha_desde: today }),
          getIncidents({ prioridad: "CRITICA",  limit: 1, page: 1 }),
          getIncidents({ prioridad: "ALTA",     limit: 1, page: 1 }),
          getIncidents({ prioridad: "MEDIA",    limit: 1, page: 1 }),
          getIncidents({ prioridad: "BAJA",     limit: 1, page: 1 }),
          getIncidents({ limit: 6, page: 1, sort: "newest", fecha_desde: today }),
          getIncidents({ prioridad: "CRITICA",  limit: 5, page: 1, sort: "priority" }),
          getIncidents({ limit: 200, page: 1, sort: "newest" }),
          ...days.map(d => getIncidents({ limit: 1, page: 1, fecha_desde: d, fecha_hasta: d })),
        ])

        if (!alive) return

        // Conteo por zona desde muestra reciente
        const zonaMap = new Map<string, number>()
        for (const inc of allRecent.incidents) {
          const z = inc.zona_nombre ?? "Sin zona"
          zonaMap.set(z, (zonaMap.get(z) ?? 0) + 1)
        }
        const zonas = Array.from(zonaMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([nombre, total]) => ({ nombre, total }))

        const weeklyTrend = days.map((d, i) => ({
          date: d, label: shortDay(d),
          count: weekResults[i]?.pagination.total ?? 0,
        }))

        setState({
          loading: false,
          entrantes:   procesando.pagination.total + pendiente.pagination.total,
          validos:     validos.pagination.total,
          enAtencion:  enAtencion.pagination.total,
          rechazados:  rechazados.pagination.total,
          descartados: descartados.pagination.total + fallidos.pagination.total,
          resueltas:   resueltas.pagination.total,
          resueltosHoy: resueltosHoy.pagination.total,
          recientes:   recientes.incidents,
          criticos:    criticos.incidents,
          weeklyTrend,
          zonas,
          critica: critica.pagination.total,
          alta:    alta.pagination.total,
          media:   media.pagination.total,
          baja:    baja.pagination.total,
          error: null,
        })
      } catch (err) {
        if (!alive) return
        setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Error" }))
      }
    }
    load()
    const id = setInterval(load, 45_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const totalActivos = state.entrantes + state.validos + state.enAtencion
  const totalGlobal  = totalActivos + state.rechazados + state.descartados + state.resueltas
  const weekMax = Math.max(...state.weeklyTrend.map(d => d.count), 1)
  const zonasMax = state.zonas[0]?.total ?? 1
  const prioMax  = Math.max(state.critica, state.alta, state.media, state.baja, 1)

  const donutSegments = [
    { value: state.entrantes,  color: "#F59E0B", label: "Entrantes"   },
    { value: state.validos,    color: "#38BDF8", label: "Válidos"     },
    { value: state.enAtencion, color: "#818CF8", label: "En atención" },
    { value: state.rechazados, color: "#F87171", label: "Rechazados"  },
    { value: state.descartados,color: "#94A3B8", label: "Descartados" },
    { value: state.resueltas,  color: "#4ADE80", label: "Resueltas"   },
  ].filter(s => s.value > 0)

  const Skeleton = ({ h = "h-6", w = "w-full" }: { h?: string; w?: string }) => (
    <div className={`${h} ${w} animate-pulse rounded-lg bg-slate-100`} />
  )

  return (
    <div className="flex flex-col gap-5">

      {/* ── Saludo ──────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{greeting}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-slate-900">{user?.nombre ?? "Supervisor"}</h2>
        <p className="mt-0.5 text-sm capitalize text-slate-500">{dateLabel}</p>
      </div>

      {/* ── KPIs principales ────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Sin revisar"   value={state.entrantes}    hint="Esperan tu revisión"         href="/dashboard/incidentes?sin_supervisar=true"                    accent="#F59E0B" loading={state.loading} />
        <KpiCard label="Válidos"       value={state.validos}      hint="Confirmados como casos reales" href="/dashboard/incidentes?estado=VALIDO&sin_supervisar=false"   accent="#38BDF8" loading={state.loading} />
        <KpiCard label="En atención"   value={state.enAtencion}   hint="Con operario asignado"        href="/dashboard/incidentes?estado=EN_ATENCION&sin_supervisar=false" accent="#818CF8" loading={state.loading} />
        <KpiCard label="Resueltos hoy" value={state.resueltosHoy} hint="Cerrados en este turno"       href="/dashboard/incidentes?estado=RESUELTA&sin_supervisar=false"  accent="#4ADE80" loading={state.loading} />
      </div>

      {/* ── Fila: Tendencia + Distribución ──────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">

        {/* Tendencia 7 días */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Tendencia últimos 7 días</div>
            <div className="text-xs text-slate-500">Casos reportados por día</div>
          </div>
          {state.loading
            ? <Skeleton h="h-24" />
            : <WeeklyBar days={state.weeklyTrend} max={weekMax} />
          }
        </div>

        {/* Distribución por estado */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Distribución de estados</div>
            <div className="text-xs text-slate-500">{totalGlobal} casos en total</div>
          </div>
          {state.loading
            ? <Skeleton h="h-24" />
            : (
              <div className="flex items-center gap-4">
                <DonutChart segments={donutSegments} size={100} />
                <div className="grid gap-1.5 flex-1 min-w-0">
                  {donutSegments.map(s => (
                    <div key={s.label} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate text-slate-600">{s.label}</span>
                      <span className="ml-auto font-bold tabular-nums text-slate-900">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          }
        </div>
      </div>

      {/* ── Fila: Zonas + Prioridad ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Casos por zona</div>
            <div className="text-xs text-slate-500">Top 6 zonas con más incidentes</div>
          </div>
          {state.loading
            ? <div className="grid gap-3">{[1,2,3,4].map(i => <Skeleton key={i} />)}</div>
            : state.zonas.length === 0
              ? <p className="text-sm text-slate-400">Sin datos disponibles.</p>
              : <div className="grid gap-3">{state.zonas.map(z => <HBar key={z.nombre} label={z.nombre} value={z.total} max={zonasMax} color="#005BAC" />)}</div>
          }
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Distribución por prioridad</div>
            <div className="text-xs text-slate-500">Todos los casos activos</div>
          </div>
          {state.loading
            ? <div className="grid gap-3">{[1,2,3,4].map(i => <Skeleton key={i} />)}</div>
            : (
              <div className="grid gap-3">
                <HBar label="Crítica" value={state.critica} max={prioMax} color="#DC2626" />
                <HBar label="Alta"    value={state.alta}    max={prioMax} color="#EA580C" />
                <HBar label="Media"   value={state.media}   max={prioMax} color="#CA8A04" />
                <HBar label="Baja"    value={state.baja}    max={prioMax} color="#16A34A" />
              </div>
            )
          }
        </div>
      </div>

      {/* ── Métricas operativas ──────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <div className="text-sm font-extrabold text-slate-900">Resumen operativo</div>
          <div className="text-xs text-slate-500">Tasas calculadas sobre el total de casos</div>
        </div>
        {state.loading
          ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} h="h-16" />)}</div>
          : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricBlock label="Tasa de resolución"  value={totalGlobal > 0 ? `${Math.round((state.resueltas / totalGlobal) * 100)}%` : "—"} hint="Resueltos / total" />
              <MetricBlock label="Tasa de rechazo"     value={totalGlobal > 0 ? `${Math.round(((state.rechazados + state.descartados) / totalGlobal) * 100)}%` : "—"} hint="Rechazados + descartados" />
              <MetricBlock label="Casos activos"       value={String(totalActivos)}     hint="Sin revisar + válidos + en atención" />
              <MetricBlock label="Críticos activos"    value={String(state.critica)}    hint="Prioridad CRÍTICA" />
            </div>
          )
        }
      </div>

      {/* ── Llegadas hoy ────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Llegadas hoy</div>
            <div className="text-xs text-slate-500">Reportes de las últimas 24 h</div>
          </div>
          <Link to="/dashboard/incidentes" className="text-xs font-bold text-[#005BAC] hover:underline">Ver todas →</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {state.loading && <li className="px-5 py-4 text-xs text-slate-400">Cargando…</li>}
          {!state.loading && state.recientes.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-400">Sin incidencias hoy todavía.</li>
          )}
          {state.recientes.map((c) => (
            <li key={c.id}>
              <Link to={`/dashboard/incidentes?id=${c.id}&sin_supervisar=false`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[c.prioridad ?? "BAJA"] }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{c.zona_nombre ?? "Zona sin definir"}</div>
                  <div className="text-xs text-slate-500">{c.ciudadano_nombre ?? "Ciudadano"} · {fmtTime(c.created_at)}</div>
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

      {/* ── Casos críticos ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">Casos críticos</div>
            <div className="text-xs text-slate-500">Top 5 por prioridad — requieren atención inmediata</div>
          </div>
          <Link to="/dashboard/incidentes?prioridad=CRITICA&sin_supervisar=false"
            className="text-xs font-bold text-[#005BAC] hover:underline">Ver todos →</Link>
        </div>
        <ul className="divide-y divide-slate-100">
          {state.loading && <li className="px-5 py-4 text-xs text-slate-400">Cargando…</li>}
          {!state.loading && state.criticos.length === 0 && (
            <li className="px-5 py-4 text-xs text-slate-400">Sin casos críticos activos.</li>
          )}
          {state.criticos.map((c) => (
            <li key={c.id}>
              <Link to={`/dashboard/incidentes?id=${c.id}&sin_supervisar=false`}
                className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PRIORITY_DOT[c.prioridad ?? "BAJA"] }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900">{c.zona_nombre ?? "Zona sin definir"}</div>
                  <div className="text-xs text-slate-500">{c.ciudadano_nombre ?? "Ciudadano"} · {fmtTime(c.created_at)}</div>
                </div>
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {c.estado.replaceAll("_", " ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Accesos rápidos ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link to="/dashboard/incidentes"
          className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 transition">
          <div>
            <div className="text-sm font-bold text-slate-900">Bandeja de incidentes</div>
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
