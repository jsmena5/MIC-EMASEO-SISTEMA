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
import { ESTADO_STYLE, fmtDate } from "./styles"

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()

  const filtersFromUrl: IncidentFilters = useMemo(() => ({
    estado:    (params.get("estado") as IncidentEstado | null) || "",
    prioridad: (params.get("prioridad") as Prioridad | null)  || "",
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
    if (selectedId)     nextParams.set("id",        selectedId)
    setParams(nextParams, { replace: true })
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    const nextParams = new URLSearchParams(params)
    nextParams.set("id", id)
    setParams(nextParams, { replace: true })
  }

  const handleModalDone = () => {
    setReviewOpen(false); setRejectOpen(false)
    refresh()
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">

      {/* ── Filtros + botón actualizar ─────────────────────────── */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <FiltersBar filters={filters} onChange={handleFiltersChange} />
        </div>
        <button
          onClick={refresh}
          title="Actualizar incidencias"
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 active:scale-95 transition"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {/* ── Grid principal ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid gap-3 sm:grid-cols-[300px_minmax(0,1fr)]">

        {/* Lista de incidencias */}
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

        {/* Panel derecho */}
        <div className="overflow-y-auto min-h-0 rounded-2xl border border-slate-200 bg-white">

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

          {detail && !detailLoading && !detailError && (
            <div className="flex h-full flex-col">

              {/* Preview principal — imagen grande + datos + botones */}
              <IncidentPreview
                detail={detail}
                onReview={() => setReviewOpen(true)}
                onReject={() => setRejectOpen(true)}
              />

              {/* Paneles colapsables debajo de la imagen */}
              <div className="shrink-0 grid gap-2 p-4 text-xs border-t border-slate-100">

                <details
                  open={showContext}
                  onToggle={(e) => setShowContext((e.target as HTMLDetailsElement).open)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer font-bold text-slate-700">Contexto del reporte</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <KV label="Ciudadano"  value={detail.ciudadano_nombre ?? "—"} />
                    <KV label="Correo"     value={detail.ciudadano_email  ?? "—"} />
                    <KV label="Zona"       value={detail.zona_nombre      ?? "—"} />
                    <KV label="Dirección"  value={detail.direccion        ?? "Sin dirección"} />
                    <KV label="Latitud"    value={String(detail.latitud)} />
                    <KV label="Longitud"   value={String(detail.longitud)} />
                  </div>
                  {detail.descripcion && (
                    <div className="mt-3 rounded-lg bg-white p-3 text-slate-700 italic">"{detail.descripcion}"</div>
                  )}
                </details>

                <details
                  open={showDiagnostic}
                  onToggle={(e) => setShowDiagnostic((e.target as HTMLDetailsElement).open)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer font-bold text-slate-700">Diagnóstico IA</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <KV label="Confianza"    value={`${Math.round((detail.confianza_decision ?? detail.confianza ?? 0) * 100)}%`} />
                    <KV label="Tipo residuo" value={detail.tipo_residuo ? ({ DOMESTICO:"Doméstico",ORGANICO:"Orgánico",RECICLABLE:"Reciclable",ESCOMBROS:"Escombros",PELIGROSO:"Peligroso",MIXTO:"Mixto",OTRO:"Otro" }[detail.tipo_residuo] ?? detail.tipo_residuo) : "—"} />
                    <KV label="Acumulación"  value={detail.nivel_acumulacion ? ({ BAJO:"Bajo",MEDIO:"Medio",ALTO:"Alto",CRITICO:"Crítico" }[detail.nivel_acumulacion] ?? detail.nivel_acumulacion) : "—"} />
                    <KV label="Volumen"      value={detail.volumen_estimado_m3 != null ? `${Number(detail.volumen_estimado_m3).toFixed(2)} m³ (ref.)` : "Sin dato"} />
                    <KV label="Detecciones"  value={String(detail.num_detecciones ?? 0)} />
                    <KV label="Tiempo IA"    value={detail.tiempo_inferencia_ms ? `${detail.tiempo_inferencia_ms} ms` : "—"} />
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  )
}
