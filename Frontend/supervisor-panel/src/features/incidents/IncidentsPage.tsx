import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  getIncidentDetail,
  getIncidents,
  type IncidentDetail,
  type IncidentEstado,
  type IncidentFilters,
  type IncidentListItem,
  type Prioridad,
} from "../../services/incident.service"
import FiltersBar from "./FiltersBar"
import IncidentRail from "./IncidentRail"
import IncidentPreview from "./IncidentPreview"
import ReviewModal from "./ReviewModal"
import CaseTimeline from "./CaseTimeline"

// ── Tarjetas de conteo por grupo ──────────────────────────────────────────────

interface GroupCount {
  entrantes: number
  validos: number
  rechazados: number
  descartados: number
  revisados: number   // total procesados (todos - PROCESANDO)
}

type ActiveGroup = "entrantes" | "validos" | "rechazados" | "descartados" | null

// Mapa de grupo → filtros aplicados al hacer click en la tarjeta
const GROUP_FILTERS: Record<string, Partial<IncidentFilters>> = {
  // ENTRANTES: muestra PENDIENTE (los que el supervisor puede clasificar ahora)
  entrantes:   { sin_supervisar: false, estado: "PENDIENTE" },
  validos:     { sin_supervisar: false, estado: "VALIDO" },
  rechazados:  { sin_supervisar: false, estado: "RECHAZADO" },
  descartados: { sin_supervisar: false, estado: "DESCARTADO" },
}

function StatCard({ label, value, color, dot, active, onClick, loading }: Readonly<{
  label: string
  value: number
  color: string
  dot: string
  active: boolean
  onClick: () => void
  loading: boolean
}>) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex-1 min-w-[110px] rounded-2xl border p-4 text-left transition",
        active
          ? "border-[#005BAC] bg-[#EBF4FF] shadow-sm"
          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dot }} />
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      </div>
      <div className="text-2xl font-black tabular-nums" style={{ color }}>
        {loading ? <span className="text-slate-300">—</span> : value}
      </div>
    </button>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()

  const filtersFromUrl: IncidentFilters = useMemo(() => ({
    estado:        (params.get("estado") as IncidentEstado | null) || "",
    prioridad:     (params.get("prioridad") as Prioridad | null)   || "",
    sin_supervisar: params.has("sin_supervisar") ? params.get("sin_supervisar") === "true" : true,
    page:  1,
    limit: 20,
    sort:  "priority",
  }), [params])

  const [filters,    setFilters]    = useState<IncidentFilters>(filtersFromUrl)
  const [incidents,  setIncidents]  = useState<IncidentListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, limit: 20 })
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"))
  const [detail,     setDetail]     = useState<IncidentDetail | null>(null)
  const [listLoading,   setListLoading]   = useState(true)
  const [listError,     setListError]     = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState<string | null>(null)
  const [reviewOpen,    setReviewOpen]    = useState(false)
  const [rejectOpen,    setRejectOpen]    = useState(false)
  const [showContext,   setShowContext]   = useState(false)
  const [showDiagnostic,setShowDiagnostic] = useState(false)
  const [showTimeline,  setShowTimeline]  = useState(false)
  const [mobileView,    setMobileView]    = useState<"list" | "detail">("list")

  // Conteos de grupos para las tarjetas
  const [groupCounts, setGroupCounts] = useState<GroupCount>({ entrantes: 0, validos: 0, rechazados: 0, descartados: 0, revisados: 0 })
  const [groupLoading, setGroupLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState<ActiveGroup>(null)

  // Sync URL → filtros
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      estado:    filtersFromUrl.estado,
      prioridad: filtersFromUrl.prioridad,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersFromUrl.estado, filtersFromUrl.prioridad])

  // Cargar conteos de grupos
  const loadGroupCounts = useCallback(async () => {
    setGroupLoading(true)
    try {
      const [procesando, pendiente, validos, rechazados, descartados, fallidos, revisados] = await Promise.all([
        // ENTRANTES = PROCESANDO + PENDIENTE (aún no clasificados por supervisor)
        getIncidents({ estado: "PROCESANDO",  limit: 1, page: 1 }),
        getIncidents({ estado: "PENDIENTE",   limit: 1, page: 1 }),
        getIncidents({ estado: "VALIDO",      limit: 1, page: 1 }),
        getIncidents({ estado: "RECHAZADO",   limit: 1, page: 1 }),
        getIncidents({ estado: "DESCARTADO",  limit: 1, page: 1 }),
        getIncidents({ estado: "FALLIDO",     limit: 1, page: 1 }),
        getIncidents({ sin_supervisar: false, limit: 1, page: 1 }),
      ])
      setGroupCounts({
        entrantes:   procesando.pagination.total + pendiente.pagination.total,
        validos:     validos.pagination.total,
        rechazados:  rechazados.pagination.total,
        descartados: descartados.pagination.total + fallidos.pagination.total,
        revisados:   revisados.pagination.total,
      })
    } catch { /* silencioso */ }
    finally { setGroupLoading(false) }
  }, [])

  const loadList = useCallback(async (next: IncidentFilters) => {
    setListLoading(true); setListError(null)
    try {
      const data = await getIncidents(next)
      setIncidents(data.incidents)
      setPagination(data.pagination)
      if (!selectedId && data.incidents.length > 0) setSelectedId(data.incidents[0].id)
    } catch (err) {
      setListError(err instanceof Error ? err.message : "No se pudo cargar la bandeja.")
    } finally {
      setListLoading(false)
    }
  }, [selectedId])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true); setDetailError(null)
    try {
      const d = await getIncidentDetail(id)
      setDetail(d)
    } catch (err) {
      setDetail(null)
      setDetailError(err instanceof Error ? err.message : "No se pudo cargar el detalle.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGroupCounts()
    const id = setInterval(loadGroupCounts, 60_000)
    return () => clearInterval(id)
  }, [loadGroupCounts])

  useEffect(() => {
    loadList(filters)
    const id = setInterval(() => loadList(filters), 30_000)
    return () => clearInterval(id)
  }, [filters, loadList])

  useEffect(() => {
    if (selectedId) {
      setShowContext(false); setShowDiagnostic(false); setShowTimeline(false)
      loadDetail(selectedId)
    }
  }, [selectedId, loadDetail])

  const refresh = () => {
    loadGroupCounts()
    loadList(filters)
    if (selectedId) loadDetail(selectedId)
  }

  const handleFiltersChange = (next: IncidentFilters) => {
    setFilters(next)
    setActiveGroup(null)
    const nextParams = new URLSearchParams(params)
    if (next.estado)    nextParams.set("estado",    next.estado)
    else                nextParams.delete("estado")
    if (next.prioridad) nextParams.set("prioridad", next.prioridad)
    else                nextParams.delete("prioridad")
    nextParams.set("sin_supervisar", next.sin_supervisar ? "true" : "false")
    if (selectedId)     nextParams.set("id", selectedId)
    // Preservar tab=casos
    if (!nextParams.has("tab")) nextParams.set("tab", "casos")
    setParams(nextParams, { replace: true })
  }

  const handleGroupClick = (group: ActiveGroup) => {
    if (group === null || activeGroup === group) {
      setActiveGroup(null)
      handleFiltersChange({ ...filters, estado: "", sin_supervisar: true, page: 1 })
      return
    }
    setActiveGroup(group)
    const extra = GROUP_FILTERS[group] ?? {}
    handleFiltersChange({ ...filters, ...extra, page: 1 })
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setMobileView("detail")
    const nextParams = new URLSearchParams(params)
    nextParams.set("id", id)
    if (!nextParams.has("tab")) nextParams.set("tab", "casos")
    setParams(nextParams, { replace: true })
  }

  const handleModalDone = () => {
    setReviewOpen(false); setRejectOpen(false)
    const currentIndex = incidents.findIndex((i) => i.id === selectedId)
    const nextIncident = incidents[currentIndex + 1] ?? incidents[currentIndex - 1] ?? null
    if (nextIncident) setSelectedId(nextIncident.id)
    loadGroupCounts()
    loadList(filters)
  }

  const isEmpty = !listLoading && !listError && incidents.length === 0

  return (
    <div className="flex flex-col gap-3">

      {/* ── Tarjetas de grupo ──────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Entrantes"
          value={groupCounts.entrantes}
          color="#B45309"
          dot="#F59E0B"
          active={activeGroup === "entrantes"}
          onClick={() => handleGroupClick("entrantes")}
          loading={groupLoading}
        />
        <StatCard
          label="Válidos"
          value={groupCounts.validos}
          color="#0369A1"
          dot="#38BDF8"
          active={activeGroup === "validos"}
          onClick={() => handleGroupClick("validos")}
          loading={groupLoading}
        />
        <StatCard
          label="Rechazados"
          value={groupCounts.rechazados}
          color="#991B1B"
          dot="#F87171"
          active={activeGroup === "rechazados"}
          onClick={() => handleGroupClick("rechazados")}
          loading={groupLoading}
        />
        <StatCard
          label="Descartados"
          value={groupCounts.descartados}
          color="#475569"
          dot="#94A3B8"
          active={activeGroup === "descartados"}
          onClick={() => handleGroupClick("descartados")}
          loading={groupLoading}
        />
        <StatCard
          label="Revisados"
          value={groupCounts.revisados}
          color="#166534"
          dot="#4ADE80"
          active={false}
          onClick={() => handleGroupClick(null)}
          loading={groupLoading}
        />
      </div>

      {/* ── Filtros + botón actualizar ──────────────────────────── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1 min-w-0">
          <FiltersBar filters={filters} onChange={handleFiltersChange} />
        </div>
        <button
          onClick={refresh}
          title="Actualizar"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition sm:py-2.5 sm:shrink-0"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* ── Estado vacío ───────────────────────────────────────── */}
      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 px-6">
          <svg className="h-14 w-14 text-slate-200" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <div className="text-center">
            <p className="text-xl font-extrabold text-slate-400">Nada por aquí…</p>
            <p className="mt-1 text-sm text-slate-400">No hay casos con los filtros actuales.</p>
          </div>
          <button
            onClick={() => handleFiltersChange({ page: 1, limit: 20, sin_supervisar: true })}
            className="rounded-xl bg-[#005BAC] px-4 py-2 text-xs font-bold text-white hover:bg-[#004B8E] transition"
          >
            Ver entrantes
          </button>
        </div>
      )}

      {/* ── Grid principal ─────────────────────────────────────── */}
      {!isEmpty && (
        <div className="grid gap-3 items-start sm:grid-cols-[300px_minmax(0,1fr)]">

          {/* Lista */}
          <div className={[
            "sm:sticky sm:top-4",
            mobileView === "list" ? "block" : "hidden sm:block",
          ].join(" ")}>
            <IncidentRail
              incidents={incidents}
              selectedId={selectedId}
              onSelect={handleSelect}
              loading={listLoading}
              error={listError}
              onRetry={() => loadList(filters)}
              sort={filters.sort ?? "priority"}
              onSortChange={(s) => handleFiltersChange({ ...filters, sort: s, page: 1 })}
            />
          </div>

          {/* Panel derecho */}
          <div className={[
            "rounded-2xl border border-slate-200 bg-white",
            mobileView === "detail" ? "block" : "hidden sm:block",
          ].join(" ")}>

            {detailLoading && (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">Cargando…</div>
            )}

            {detailError && !detailLoading && (
              <div className="flex h-64 flex-col items-center justify-center gap-3 p-8">
                <div className="text-sm font-bold text-red-600">{detailError}</div>
                <button onClick={() => selectedId && loadDetail(selectedId)}
                  className="rounded-lg bg-[#005BAC] px-3 py-2 text-xs font-bold text-white">
                  Reintentar
                </button>
              </div>
            )}

            {!detailLoading && !detailError && !detail && (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400">
                Selecciona un caso de la lista
              </div>
            )}

            {/* Botón volver — solo en móvil */}
            {mobileView === "detail" && (
              <button
                onClick={() => setMobileView("list")}
                className="sm:hidden flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-bold text-[#005BAC]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Volver a la lista
              </button>
            )}

            {detail && !detailLoading && !detailError && (
              <div>
                <IncidentPreview
                  detail={detail}
                  onReview={() => setReviewOpen(true)}
                  onReject={() => setRejectOpen(true)}
                />

                <div className="grid gap-2 p-4 text-xs">
                  <details
                    open={showContext}
                    onToggle={(e) => setShowContext((e.target as HTMLDetailsElement).open)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <summary className="cursor-pointer font-bold text-slate-700">Contexto del reporte</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <KvRow label="Ciudadano"  value={detail.ciudadano_nombre ?? "—"} />
                      <KvRow label="Correo"     value={detail.ciudadano_email  ?? "—"} />
                      <KvRow label="Zona"       value={detail.zona_nombre      ?? "Sin zona asignada"} />
                      {detail.direccion && detail.direccion !== "Sin dirección" && (
                        <KvRow label="Dirección" value={detail.direccion} />
                      )}
                      <div className="rounded-lg bg-white p-2 sm:col-span-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Coordenadas GPS</div>
                        <div className="mt-0.5 flex items-center gap-3 text-xs font-semibold text-slate-800">
                          <span>{detail.latitud?.toFixed(6) ?? "—"}</span>
                          <span className="text-slate-300">|</span>
                          <span>{detail.longitud?.toFixed(6) ?? "—"}</span>
                          <a
                            href={`https://www.google.com/maps?q=${detail.latitud},${detail.longitud}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-[#005BAC] hover:underline text-[11px]"
                          >
                            Ver en mapa →
                          </a>
                        </div>
                      </div>
                    </div>
                    {detail.descripcion && (
                      <div className="mt-2 rounded-lg bg-white p-3 text-slate-700 italic text-xs">"{detail.descripcion}"</div>
                    )}
                  </details>

                  <details
                    open={showDiagnostic}
                    onToggle={(e) => setShowDiagnostic((e.target as HTMLDetailsElement).open)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <summary className="cursor-pointer font-bold text-slate-700">Diagnóstico IA</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <KvRow label="Confianza"    value={`${Math.round((detail.confianza_decision ?? detail.confianza ?? 0) * 100)}%`} />
                      <KvRow label="Tipo residuo" value={detail.tipo_residuo ? ({ DOMESTICO:"Doméstico",ORGANICO:"Orgánico",RECICLABLE:"Reciclable",ESCOMBROS:"Escombros",PELIGROSO:"Peligroso",MIXTO:"Mixto",OTRO:"Otro" }[detail.tipo_residuo] ?? detail.tipo_residuo) : "—"} />
                      <KvRow label="Acumulación"  value={detail.nivel_acumulacion ? ({ BAJO:"Bajo",MEDIO:"Medio",ALTO:"Alto",CRITICO:"Crítico" }[detail.nivel_acumulacion] ?? detail.nivel_acumulacion) : "—"} />
                      <KvRow label="Volumen"      value={detail.volumen_estimado_m3 == null ? "Sin dato" : `${Number(detail.volumen_estimado_m3).toFixed(2)} m³ (ref.)`} />
                      <KvRow label="Detecciones"  value={String(detail.num_detecciones ?? 0)} />
                      <KvRow label="Tiempo IA"    value={detail.tiempo_inferencia_ms ? `${detail.tiempo_inferencia_ms} ms` : "—"} />
                    </div>
                  </details>

                  <details
                    open={showTimeline}
                    onToggle={(e) => setShowTimeline((e.target as HTMLDetailsElement).open)}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                  >
                    <summary className="cursor-pointer font-bold text-slate-700">Trazabilidad del caso</summary>
                    <div className="mt-3">
                      <CaseTimeline detail={detail} />
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Paginación */}
      {pagination.pages > 1 && !isEmpty && (
        <div className="flex shrink-0 items-center justify-between text-xs text-slate-500">
          <span>{pagination.total} casos en total</span>
          <div className="flex items-center gap-3">
            <button disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40">
              ← Anterior
            </button>
            <span className="font-bold text-slate-700">Página {pagination.page} de {pagination.pages}</span>
            <button disabled={pagination.page >= pagination.pages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40">
              Siguiente →
            </button>
          </div>
        </div>
      )}

      {/* Modal de revisión */}
      {(reviewOpen || rejectOpen) && detail && (
        <ReviewModal
          detail={detail}
          initialStep={rejectOpen ? "reject" : "validate"}
          onClose={() => { setReviewOpen(false); setRejectOpen(false) }}
          onDone={handleModalDone}
        />
      )}
    </div>
  )
}

function KvRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-white p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  )
}
