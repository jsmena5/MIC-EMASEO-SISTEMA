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

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()

  const filtersFromUrl: IncidentFilters = useMemo(() => ({
    estado:        (params.get("estado") as IncidentEstado | null) || "",
    prioridad:     (params.get("prioridad") as Prioridad | null)  || "",
    // Por defecto solo muestra incidencias sin supervisar → las ya revisadas no
    // aparecen en la vista principal. El supervisor puede quitarlo con el filtro.
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

  // Modal de revisión
  const [reviewOpen,      setReviewOpen]      = useState(false)
  const [rejectOpen,      setRejectOpen]      = useState(false)
  const [showContext,     setShowContext]     = useState(false)
  const [showDiagnostic,  setShowDiagnostic]  = useState(false)
  const [showTimeline,    setShowTimeline]    = useState(false)
  // Móvil: alterna entre vista de lista y vista de detalle
  const [mobileView, setMobileView] = useState<"list" | "detail">("list")

  // Sync URL → filtros (solo estado y prioridad, sin borrar filtros locales)
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      estado:    filtersFromUrl.estado,
      prioridad: filtersFromUrl.prioridad,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersFromUrl.estado, filtersFromUrl.prioridad])

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

  const refresh = () => { loadList(filters); if (selectedId) loadDetail(selectedId) }

  const handleFiltersChange = (next: IncidentFilters) => {
    setFilters(next)
    const nextParams = new URLSearchParams()
    if (next.estado)    nextParams.set("estado",    next.estado)
    if (next.prioridad) nextParams.set("prioridad", next.prioridad)
    // Persistir sin_supervisar en URL solo cuando NO es el default (true)
    nextParams.set("sin_supervisar", next.sin_supervisar ? "true" : "false")
    if (selectedId)     nextParams.set("id",        selectedId)
    setParams(nextParams, { replace: true })
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setMobileView("detail") // en móvil: ir al detalle al tocar una card
    const nextParams = new URLSearchParams(params)
    nextParams.set("id", id)
    setParams(nextParams, { replace: true })
  }

  const handleModalDone = () => {
    setReviewOpen(false); setRejectOpen(false)
    // Tras revisar: recargar lista (que excluirá el incidente con sin_supervisar=true)
    // y auto-avanzar al siguiente de la lista actual para fluidez de revisión.
    const currentIndex = incidents.findIndex((i) => i.id === selectedId)
    const nextIncident = incidents[currentIndex + 1] ?? incidents[currentIndex - 1] ?? null
    if (nextIncident) setSelectedId(nextIncident.id)
    loadList(filters)
  }

  return (
    // Layout de página normal (sin overflow-hidden) — el scroll lo maneja el
    // main del DashboardLayout. La lista usa sticky para permanecer visible.
    <div className="flex flex-col gap-3">

      {/* ── Filtros + botón actualizar ─────────────────────────────────────
           Móvil: FiltersBar ancho completo (chips sin comprimir) + botón debajo
           Desktop: lado a lado ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1 min-w-0">
          <FiltersBar filters={filters} onChange={handleFiltersChange} />
        </div>
        <button
          onClick={refresh}
          title="Actualizar incidencias"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition sm:py-2.5 sm:shrink-0"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* ── Grid principal ──────────────────────────────────────────────────
           Desktop/tablet (sm+): lista sticky izquierda + detalle derecha
           Móvil (<sm): lista O detalle (uno a la vez), con botón "Volver" ── */}
      <div className="grid gap-3 items-start sm:grid-cols-[300px_minmax(0,1fr)]">

        {/* Lista — visible en desktop siempre; en móvil solo cuando mobileView='list' */}
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

        {/* Panel derecho — en móvil solo cuando mobileView='detail' */}
        <div className={[
          "rounded-2xl border border-slate-200 bg-white",
          mobileView === "detail" ? "block" : "hidden sm:block",
        ].join(" ")}>

          {detailLoading && (
            <div className="flex h-full items-center justify-center">
              <div className="text-sm text-slate-400">Cargando…</div>
            </div>
          )}

          {detailError && !detailLoading && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
              <div className="text-sm font-bold text-red-600">{detailError}</div>
              <button onClick={() => selectedId && loadDetail(selectedId)}
                className="rounded-lg bg-[#005BAC] px-3 py-2 text-xs font-bold text-white">
                Reintentar
              </button>
            </div>
          )}

          {!detailLoading && !detailError && !detail && (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              Selecciona una incidencia de la lista
            </div>
          )}

          {/* Botón volver — solo en móvil cuando se está viendo el detalle */}
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
              {/* Preview principal: header + imagen + strip de datos */}
              <IncidentPreview
                detail={detail}
                onReview={() => setReviewOpen(true)}
                onReject={() => setRejectOpen(true)}
              />

              {/* Paneles colapsables — contexto, diagnóstico, trazabilidad */}
              <div className="grid gap-2 p-4 text-xs">

                <details
                  open={showContext}
                  onToggle={(e) => setShowContext((e.target as HTMLDetailsElement).open)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer font-bold text-slate-700">Contexto del reporte</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <KvRow label="Ciudadano"    value={detail.ciudadano_nombre ?? "—"} />
                    <KvRow label="Correo"       value={detail.ciudadano_email  ?? "—"} />
                    <KvRow label="Zona"         value={detail.zona_nombre      ?? "Sin zona asignada"} />
                    {detail.direccion && detail.direccion !== "Sin dirección" && (
                      <KvRow label="Dirección"  value={detail.direccion} />
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

      {/* Paginación */}
      {pagination.pages > 1 && (
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

      {/* Modal de revisión / clasificación */}
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
