import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import {
  getIncidentDetail,
  getIncidents,
  getOperarios,
  type IncidentDetail,
  type IncidentEstado,
  type IncidentFilters,
  type IncidentListItem,
  type OperarioItem,
  type Prioridad,
} from "../../services/incident.service"
import FiltersBar from "./FiltersBar"
import IncidentRail from "./IncidentRail"
import Stepper from "./Stepper"
import Step1Validate from "./Step1Validate"
import Step2Classify from "./Step2Classify"
import Step3Assign from "./Step3Assign"
import CaseTimeline from "./CaseTimeline"
import { TIPO_LABEL, NIVEL_LABEL, fmtPercent, fmtVolume, fmtDate } from "./styles"

type Step = 1 | 2 | 3

function initialStepFor(detail: IncidentDetail | null): Step {
  if (!detail) return 1
  switch (detail.estado) {
    case "PROCESANDO":
    case "FALLIDO":
    case "EN_REVISION":
    case "DESCARTADO":
      return 1
    case "PENDIENTE":
      // si la IA ya fue validada (correctamente o no), saltar a paso 3
      return detail.ia_fue_correcta != null ? 3 : 2
    case "EN_ATENCION":
    case "RESUELTA":
    case "RECHAZADA":
      return 3
    default:
      return 1
  }
}

function reachableStepFor(detail: IncidentDetail | null): Step {
  if (!detail) return 1
  if (detail.estado === "DESCARTADO" || detail.estado === "FALLIDO") return 1
  return 3
}

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()

  const filtersFromUrl: IncidentFilters = useMemo(() => ({
    estado:    (params.get("estado") as IncidentEstado | null) || "",
    prioridad: (params.get("prioridad") as Prioridad | null) || "",
    page:  1,
    limit: 20,
    sort:  "priority",
  }), [params])

  const [filters,    setFilters]    = useState<IncidentFilters>(filtersFromUrl)
  const [incidents,  setIncidents]  = useState<IncidentListItem[]>([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, pages: 1, limit: 20 })
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"))
  const [detail,     setDetail]     = useState<IncidentDetail | null>(null)
  const [operarios,  setOperarios]  = useState<OperarioItem[]>([])
  const [listLoading,   setListLoading]   = useState(true)
  const [listError,     setListError]     = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError,   setDetailError]   = useState<string | null>(null)

  const [step, setStep] = useState<Step>(1)
  const [showTimeline, setShowTimeline] = useState(false)
  const [showContext,  setShowContext]  = useState(false)

  // La URL es fuente externa de filtros (links de Topbar/Home con ?estado=).
  useEffect(() => {
    setFilters(filtersFromUrl)
  }, [filtersFromUrl])

  const loadList = useCallback(async (next: IncidentFilters) => {
    setListLoading(true)
    setListError(null)
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
    setDetailLoading(true)
    setDetailError(null)
    try {
      const [d, ops] = await Promise.all([getIncidentDetail(id), getOperarios()])
      setDetail(d)
      setOperarios(ops.operarios)
      setStep(initialStepFor(d))
    } catch (err) {
      setDetail(null)
      setDetailError(err instanceof Error ? err.message : "No se pudo cargar el detalle.")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // Data fetching con auto-refresh: el setState ocurre tras la respuesta async.
  useEffect(() => {
    loadList(filters)
    const id = setInterval(() => loadList(filters), 30_000)
    return () => clearInterval(id)
  }, [filters, loadList])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const refresh = () => {
    loadList(filters)
    if (selectedId) loadDetail(selectedId)
  }

  const handleFiltersChange = (next: IncidentFilters) => {
    setFilters(next)
    // sync solo lo más importante a URL
    const nextParams = new URLSearchParams()
    if (next.estado)    nextParams.set("estado",    next.estado)
    if (next.prioridad) nextParams.set("prioridad", next.prioridad)
    if (selectedId)     nextParams.set("id",        selectedId)
    setParams(nextParams, { replace: true })
  }

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setShowContext(false)
    setShowTimeline(false)
    const nextParams = new URLSearchParams(params)
    nextParams.set("id", id)
    setParams(nextParams, { replace: true })
  }

  const reachable = reachableStepFor(detail)

  return (
    <div className="grid gap-4">
      <FiltersBar filters={filters} onChange={handleFiltersChange} />

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
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

        {/* Workspace */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          {detailLoading && (
            <div className="py-16 text-center text-sm text-slate-500">Cargando detalle…</div>
          )}
          {detailError && !detailLoading && (
            <div className="py-16 text-center">
              <div className="text-sm font-bold text-red-600">{detailError}</div>
              <button
                onClick={() => selectedId && loadDetail(selectedId)}
                className="mt-3 rounded-lg bg-[#005BAC] px-3 py-2 text-xs font-bold text-white"
              >
                Reintentar
              </button>
            </div>
          )}
          {!detailLoading && !detailError && !detail && (
            <div className="py-16 text-center text-sm text-slate-500">
              Selecciona un caso del listado para revisarlo.
            </div>
          )}

          {detail && !detailLoading && !detailError && (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Caso #{detail.id.slice(0, 8)}
                  </div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    {detail.zona_nombre ?? "Zona sin definir"}
                  </h2>
                  <div className="text-xs text-slate-500">
                    {detail.ciudadano_nombre ?? "Ciudadano no disponible"} · {fmtDate(detail.created_at)}
                  </div>
                </div>
                <Stepper current={step} reachable={reachable} onJump={(s) => setStep(s)} />
              </div>

              {step === 1 && (
                <Step1Validate detail={detail} onAdvance={() => setStep(2)} onRefresh={refresh} />
              )}
              {step === 2 && (
                <Step2Classify detail={detail} onAdvance={() => setStep(3)} onRefresh={refresh} />
              )}
              {step === 3 && (
                <Step3Assign detail={detail} operarios={operarios} onRefresh={refresh} />
              )}

              {/* Paneles colapsables: contexto + diagnóstico + timeline */}
              <div className="grid gap-2 text-xs">
                <details
                  open={showContext}
                  onToggle={(e) => setShowContext((e.target as HTMLDetailsElement).open)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer font-bold text-slate-700">
                    Contexto del reporte
                  </summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <KV label="Ciudadano"  value={detail.ciudadano_nombre ?? "—"} />
                    <KV label="Correo"     value={detail.ciudadano_email ?? "—"} />
                    <KV label="Zona"       value={detail.zona_nombre ?? "—"} />
                    <KV label="Dirección"  value={detail.direccion ?? "Sin dirección"} />
                    <KV label="Latitud"    value={String(detail.latitud)} />
                    <KV label="Longitud"   value={String(detail.longitud)} />
                  </div>
                  {detail.descripcion && (
                    <div className="mt-3 rounded-lg bg-white p-3 text-slate-700 italic">"{detail.descripcion}"</div>
                  )}
                </details>

                <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <summary className="cursor-pointer font-bold text-slate-700">
                    Diagnóstico IA
                  </summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <KV label="Confianza"     value={fmtPercent(detail.confianza_decision ?? detail.confianza)} />
                    <KV label="Tipo residuo"  value={detail.tipo_residuo ? TIPO_LABEL[detail.tipo_residuo] : "—"} />
                    <KV label="Acumulación"   value={detail.nivel_acumulacion ? NIVEL_LABEL[detail.nivel_acumulacion] : "—"} />
                    <KV label="Volumen"       value={fmtVolume(detail.volumen_estimado_m3)} />
                    <KV label="Detecciones"   value={String(detail.num_detecciones ?? detail.detecciones?.length ?? 0)} />
                    <KV label="Tiempo IA"     value={detail.tiempo_inferencia_ms ? `${detail.tiempo_inferencia_ms} ms` : "—"} />
                  </div>
                </details>

                <details
                  open={showTimeline}
                  onToggle={(e) => setShowTimeline((e.target as HTMLDetailsElement).open)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <summary className="cursor-pointer font-bold text-slate-700">
                    Trazabilidad del caso
                  </summary>
                  <div className="mt-3">
                    <CaseTimeline detail={detail} />
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{pagination.total} casos en total</span>
          <div className="flex items-center gap-3">
            <button
              disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="font-bold text-slate-700">Página {pagination.page} de {pagination.pages}</span>
            <button
              disabled={pagination.page >= pagination.pages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1 font-semibold disabled:opacity-40"
            >
              Siguiente →
            </button>
          </div>
        </div>
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
