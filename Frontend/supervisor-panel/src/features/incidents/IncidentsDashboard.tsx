/**
 * IncidentsDashboard — analíticas operativas estilo GLPI.
 * Construido con SVG y CSS puro sin dependencia de librería externa.
 */
import { useEffect, useState } from "react"
import { getIncidents } from "../../services/incident.service"

// ── Utilidades ────────────────────────────────────────────────────────────────

function isoDay(offsetDays: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function shortDay(isoDate: string): string {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("es-EC", { weekday: "short", day: "numeric" })
}

// ── Tipos de datos ────────────────────────────────────────────────────────────

interface DayCount { date: string; label: string; count: number }

interface ZonaStat { nombre: string; total: number }

interface DashboardData {
  // Estado actual
  entrantes: number
  validos: number
  en_atencion: number
  rechazados: number
  descartados: number
  resueltas: number
  // Últimos 7 días
  weeklyTrend: DayCount[]
  // Por prioridad
  critica: number
  alta: number
  media: number
  baja: number
  // Por zona (top 6)
  zonas: ZonaStat[]
}

// ── Gráfica de donut SVG ──────────────────────────────────────────────────────

function DonutChart({ segments, size = 120 }: Readonly<{
  segments: { value: number; color: string; label: string }[]
  size?: number
}>) {
  const total = segments.reduce((s, g) => s + g.value, 0)
  if (total === 0) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 36 36">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E2E8F0" strokeWidth="3.8" />
        </svg>
      </div>
    )
  }

  const cx = 18; const cy = 18; const r = 15.9
  const circumference = 2 * Math.PI * r
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
        <circle key={i} cx={cx} cy={cy} r={r}
          fill="none"
          stroke={arc.color}
          strokeWidth="3.8"
          strokeDasharray={`${arc.dash} ${circumference}`}
          strokeDashoffset={arc.offset}
        />
      ))}
    </svg>
  )
}

// ── Gráfica de barras horizontal ──────────────────────────────────────────────

function HBar({ label, value, max, color }: Readonly<{
  label: string; value: number; max: number; color: string
}>) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-700 truncate max-w-[140px]">{label}</span>
        <span className="font-bold tabular-nums text-slate-900 ml-2">{value}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

// ── Barras de tendencia semanal ───────────────────────────────────────────────

function WeeklyBar({ days, max }: Readonly<{ days: DayCount[]; max: number }>) {
  return (
    <div className="flex items-end justify-between gap-1 h-28">
      {days.map(d => {
        const h = max > 0 ? Math.round((d.count / max) * 100) : 0
        return (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[10px] font-bold tabular-nums text-slate-600">{d.count > 0 ? d.count : ""}</span>
            <div className="w-full rounded-t-lg transition-all duration-500" style={{ height: `${Math.max(h, 3)}%`, background: "#005BAC", opacity: d.count === 0 ? 0.15 : 1 }} />
            <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Tarjeta KPI simple ────────────────────────────────────────────────────────

function KpiMini({ label, value, color, loading }: Readonly<{
  label: string; value: number; color: string; loading: boolean
}>) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-1">{label}</div>
      <div className="text-2xl font-black tabular-nums" style={{ color }}>
        {loading ? <span className="text-slate-200">—</span> : value}
      </div>
    </div>
  )
}

// ── Dashboard principal ───────────────────────────────────────────────────────

const EMPTY: DashboardData = {
  entrantes: 0, validos: 0, en_atencion: 0, rechazados: 0, descartados: 0, resueltas: 0,
  weeklyTrend: [], critica: 0, alta: 0, media: 0, baja: 0, zonas: [],
}

export default function IncidentsDashboard() {
  const [data, setData] = useState<DashboardData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      setLoading(true); setError(null)
      try {
        const days = Array.from({ length: 7 }, (_, i) => isoDay(i - 6))

        const [
          entrantes, validos, enAtencion, rechazados, descartadosR, fallidosR, resueltas,
          critica, alta, media, baja,
          z1, z2, z3, z4, z5, z6,
          ...weekResults
        ] = await Promise.all([
          getIncidents({ estado: "PENDIENTE",  limit: 1, page: 1 }),
          getIncidents({ estado: "VALIDO",     limit: 1, page: 1 }),
          getIncidents({ estado: "EN_ATENCION",limit: 1, page: 1 }),
          getIncidents({ estado: "RECHAZADO",  limit: 1, page: 1 }),
          getIncidents({ estado: "DESCARTADO", limit: 1, page: 1 }),
          getIncidents({ estado: "FALLIDO",    limit: 1, page: 1 }),
          getIncidents({ estado: "RESUELTA",   limit: 1, page: 1 }),
          getIncidents({ prioridad: "CRITICA", limit: 1, page: 1 }),
          getIncidents({ prioridad: "ALTA",    limit: 1, page: 1 }),
          getIncidents({ prioridad: "MEDIA",   limit: 1, page: 1 }),
          getIncidents({ prioridad: "BAJA",    limit: 1, page: 1 }),
          // top 6 zonas por nombre (aproximación con sort reciente)
          getIncidents({ limit: 200, page: 1, sort: "newest" }),
          getIncidents({ limit: 200, page: 1, sort: "newest", estado: "VALIDO" }),
          getIncidents({ limit: 200, page: 1, sort: "newest", estado: "RECHAZADO" }),
          getIncidents({ limit: 200, page: 1, sort: "newest", estado: "EN_ATENCION" }),
          getIncidents({ limit: 200, page: 1, sort: "newest", estado: "RESUELTA" }),
          getIncidents({ limit: 200, page: 1, sort: "newest", estado: "DESCARTADO" }),
          // 7 días
          ...days.map(d => getIncidents({ limit: 1, page: 1, fecha_desde: d, fecha_hasta: d })),
        ])

        if (!alive) return

        // Construir conteo por zona desde los resultados combinados
        const zonaMap = new Map<string, number>()
        const allIncidents = [
          ...z1.incidents, ...z2.incidents, ...z3.incidents,
          ...z4.incidents, ...z5.incidents, ...z6.incidents,
        ]
        for (const inc of allIncidents) {
          const z = inc.zona_nombre ?? "Sin zona"
          zonaMap.set(z, (zonaMap.get(z) ?? 0) + 1)
        }
        const zonas: ZonaStat[] = Array.from(zonaMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([nombre, total]) => ({ nombre, total }))

        const weeklyTrend: DayCount[] = days.map((d, i) => ({
          date:  d,
          label: shortDay(d),
          count: weekResults[i]?.pagination.total ?? 0,
        }))

        setData({
          entrantes:   entrantes.pagination.total,
          validos:     validos.pagination.total,
          en_atencion: enAtencion.pagination.total,
          rechazados:  rechazados.pagination.total,
          descartados: descartadosR.pagination.total + fallidosR.pagination.total,
          resueltas:   resueltas.pagination.total,
          weeklyTrend,
          critica: critica.pagination.total,
          alta:    alta.pagination.total,
          media:   media.pagination.total,
          baja:    baja.pagination.total,
          zonas,
        })
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Error al cargar el dashboard.")
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const weekMax = Math.max(...data.weeklyTrend.map(d => d.count), 1)
  const totalCurrent = data.entrantes + data.validos + data.en_atencion + data.rechazados + data.descartados + data.resueltas
  const zonasMax = data.zonas[0]?.total ?? 1
  const prioMax  = Math.max(data.critica, data.alta, data.media, data.baja, 1)

  const donutSegments = [
    { value: data.entrantes,   color: "#F59E0B", label: "Entrantes"   },
    { value: data.validos,     color: "#38BDF8", label: "Válidos"     },
    { value: data.en_atencion, color: "#818CF8", label: "En atención" },
    { value: data.rechazados,  color: "#F87171", label: "Rechazados"  },
    { value: data.descartados, color: "#94A3B8", label: "Descartados" },
    { value: data.resueltas,   color: "#4ADE80", label: "Resueltas"   },
  ].filter(s => s.value > 0)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 py-16">
        <p className="text-sm font-bold text-red-700">No se pudo cargar el dashboard</p>
        <p className="text-xs text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4">

      {/* ── Fila 1: KPIs de estado actual ───────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiMini label="Entrantes"   value={data.entrantes}   color="#B45309" loading={loading} />
        <KpiMini label="Válidos"     value={data.validos}     color="#0369A1" loading={loading} />
        <KpiMini label="En atención" value={data.en_atencion} color="#6D28D9" loading={loading} />
        <KpiMini label="Rechazados"  value={data.rechazados}  color="#991B1B" loading={loading} />
        <KpiMini label="Descartados" value={data.descartados} color="#475569" loading={loading} />
        <KpiMini label="Resueltos"   value={data.resueltas}   color="#166534" loading={loading} />
      </div>

      {/* ── Fila 2: Tendencia semanal + Distribución ────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">

        {/* Tendencia últimos 7 días */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Tendencia últimos 7 días</div>
            <div className="text-xs text-slate-500">Casos reportados por día</div>
          </div>
          {loading
            ? <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
            : <WeeklyBar days={data.weeklyTrend} max={weekMax} />
          }
        </div>

        {/* Distribución por estado */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Distribución de estados</div>
            <div className="text-xs text-slate-500">{totalCurrent} casos en total</div>
          </div>
          {loading
            ? <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
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

      {/* ── Fila 3: Por zona + Por prioridad ────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Incidentes por zona */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Casos por zona</div>
            <div className="text-xs text-slate-500">Top 6 zonas con más incidentes</div>
          </div>
          {loading
            ? <div className="grid gap-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />)}</div>
            : data.zonas.length === 0
              ? <p className="text-sm text-slate-400">Sin datos disponibles.</p>
              : (
                <div className="grid gap-3">
                  {data.zonas.map(z => (
                    <HBar key={z.nombre} label={z.nombre} value={z.total} max={zonasMax} color="#005BAC" />
                  ))}
                </div>
              )
          }
        </div>

        {/* Distribución por prioridad */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="mb-4">
            <div className="text-sm font-extrabold text-slate-900">Distribución por prioridad</div>
            <div className="text-xs text-slate-500">Todos los casos activos</div>
          </div>
          {loading
            ? <div className="grid gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" />)}</div>
            : (
              <div className="grid gap-3">
                <HBar label="Crítica" value={data.critica} max={prioMax} color="#DC2626" />
                <HBar label="Alta"    value={data.alta}    max={prioMax} color="#EA580C" />
                <HBar label="Media"   value={data.media}   max={prioMax} color="#CA8A04" />
                <HBar label="Baja"    value={data.baja}    max={prioMax} color="#16A34A" />
              </div>
            )
          }
        </div>
      </div>

      {/* ── Fila 4: Métricas de eficiencia ──────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="mb-4">
          <div className="text-sm font-extrabold text-slate-900">Resumen operativo</div>
          <div className="text-xs text-slate-500">Tasas calculadas sobre el total de casos</div>
        </div>
        {loading
          ? <div className="grid grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
          : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricBlock
                label="Tasa de resolución"
                value={totalCurrent > 0 ? `${Math.round((data.resueltas / totalCurrent) * 100)}%` : "—"}
                hint="Resueltos / total"
              />
              <MetricBlock
                label="Tasa de rechazo"
                value={totalCurrent > 0 ? `${Math.round(((data.rechazados + data.descartados) / totalCurrent) * 100)}%` : "—"}
                hint="Rechazados + descartados"
              />
              <MetricBlock
                label="Casos activos"
                value={String(data.entrantes + data.validos + data.en_atencion)}
                hint="Pendientes + válidos + en atención"
              />
              <MetricBlock
                label="Casos críticos activos"
                value={String(data.critica)}
                hint="Prioridad CRÍTICA"
              />
            </div>
          )
        }
      </div>

    </div>
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
