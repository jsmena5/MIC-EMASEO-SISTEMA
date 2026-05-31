import { useCallback, useEffect, useState } from "react"
import { listImagenes, etiquetarImagen } from "../../../services/auditoria.service"
import type { ImagenAuditoria, ImageAuditLabel } from "../../../services/auditoria.service"

// ─── Constantes visuales ──────────────────────────────────────────────────────

const ETIQUETA_CFG: Record<ImageAuditLabel, { label: string; color: string; bg: string; dot: string }> = {
  PENDIENTE:            { label: "Pendiente",    color: "#6B7280", bg: "#F3F4F6", dot: "#9CA3AF" },
  VALIDA_ENTRENAMIENTO: { label: "Válida",        color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E" },
  DUDOSA:               { label: "Dudosa",        color: "#CA8A04", bg: "#FEFCE8", dot: "#EAB308" },
  EXCLUIR:              { label: "Excluir",       color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
}

const NIVEL_COLOR: Record<string, string> = {
  BAJO: "#16A34A", MEDIO: "#CA8A04", ALTO: "#EA580C", CRITICO: "#DC2626",
}

// ─── Image card ───────────────────────────────────────────────────────────────

function ImageCard({
  img, onLabel,
}: {
  img: ImagenAuditoria
  onLabel: (id: string, etiqueta: ImageAuditLabel) => void
}) {
  const [saving, setSaving] = useState(false)
  const cfg = ETIQUETA_CFG[img.etiqueta]

  const handleLabel = async (etiqueta: ImageAuditLabel) => {
    if (saving || img.etiqueta === etiqueta) return
    setSaving(true)
    try { await etiquetarImagen(img.incident_id, etiqueta); onLabel(img.incident_id, etiqueta) }
    catch { /* silent — card stays in previous state */ }
    finally { setSaving(false) }
  }

  return (
    <div className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition ${saving ? "opacity-60" : ""}`}
         style={{ borderColor: cfg.color + "40" }}>
      {/* Image */}
      <div className="relative bg-slate-100" style={{ height: 160 }}>
        {img.image_url ? (
          <img
            src={img.image_url}
            alt="Evidencia"
            className="h-full w-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg className="h-10 w-10 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18" />
            </svg>
          </div>
        )}
        {/* Estado badge */}
        <span className="absolute top-2 left-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
          {img.estado.replace(/_/g, " ")}
        </span>
        {/* IA verdict badge */}
        {img.ia_fue_correcta != null && (
          <span className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm ${
            img.ia_fue_correcta ? "bg-emerald-500/80 text-white" : "bg-red-500/80 text-white"
          }`}>
            {img.ia_fue_correcta ? "IA ✓" : "IA ✗"}
          </span>
        )}
      </div>

      {/* ML info */}
      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          {img.tipo_residuo && (
            <span className="text-[10px] font-bold text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">
              {img.tipo_residuo}
            </span>
          )}
          {img.nivel_acumulacion && (
            <span className="text-[10px] font-bold rounded px-1.5 py-0.5"
                  style={{ color: NIVEL_COLOR[img.nivel_acumulacion] ?? "#6B7280", background: (NIVEL_COLOR[img.nivel_acumulacion] ?? "#6B7280") + "18" }}>
              {img.nivel_acumulacion}
            </span>
          )}
          {img.confianza != null && (
            <span className="text-[10px] text-slate-400">{Math.round(img.confianza * 100)}%</span>
          )}
        </div>
        {/* Supervisor correction */}
        {(img.tipo_residuo_supervisor || img.nivel_acumulacion_supervisor) && (
          <div className="mt-1 text-[10px] text-emerald-600">
            Corrección: {img.tipo_residuo_supervisor ?? ""} {img.nivel_acumulacion_supervisor ?? ""}
          </div>
        )}
        {/* Current label */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: cfg.dot }} />
          <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
          {img.etiquetado_por_email && (
            <span className="text-[10px] text-slate-400 truncate">· {img.etiquetado_por_email.split("@")[0]}</span>
          )}
        </div>
      </div>

      {/* Label buttons */}
      <div className="grid grid-cols-4 gap-1 px-3 pb-3 pt-1">
        {(["VALIDA_ENTRENAMIENTO", "DUDOSA", "EXCLUIR", "PENDIENTE"] as ImageAuditLabel[]).map((e) => {
          const c = ETIQUETA_CFG[e]
          const active = img.etiqueta === e
          return (
            <button
              key={e}
              disabled={saving}
              onClick={() => void handleLabel(e)}
              title={c.label}
              className="rounded-lg py-1.5 text-[10px] font-bold transition disabled:opacity-50"
              style={{
                background: active ? c.color : c.bg,
                color:      active ? "#fff"  : c.color,
                border:     `1px solid ${c.color}40`,
              }}
            >
              {c.label === "Válida" ? "✓" : c.label === "Dudosa" ? "?" : c.label === "Excluir" ? "✗" : "·"}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Stats summary ────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-sm font-bold tabular-nums text-slate-900">{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Filter = { etiqueta: ImageAuditLabel | ""; ia_correcta: "true" | "false" | "" }

export default function AuditoriaR2() {
  const [imagenes,   setImagenes]   = useState<ImagenAuditoria[]>([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 24, pages: 1 })
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")
  const [filter,     setFilter]     = useState<Filter>({ etiqueta: "", ia_correcta: "" })

  const load = useCallback(async (page = 1, f = filter) => {
    setLoading(true); setError("")
    try {
      const res = await listImagenes({ page, limit: 24, ...f })
      setImagenes(res.imagenes)
      setPagination(res.pagination)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar")
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load(1) }, [filter, load])

  const handleLabel = useCallback((id: string, etiqueta: ImageAuditLabel) => {
    setImagenes((prev) => prev.map((img) => img.incident_id === id ? { ...img, etiqueta } : img))
  }, [])

  const stats = {
    validas:   imagenes.filter((i) => i.etiqueta === "VALIDA_ENTRENAMIENTO").length,
    dudosas:   imagenes.filter((i) => i.etiqueta === "DUDOSA").length,
    excluir:   imagenes.filter((i) => i.etiqueta === "EXCLUIR").length,
    pendientes: imagenes.filter((i) => i.etiqueta === "PENDIENTE").length,
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">Auditoría de imágenes R2</h2>
        <p className="text-sm text-slate-500">
          Clasifica las imágenes de incidentes para el reentrenamiento del modelo IA.
          {!loading && ` · ${pagination.total} imágenes en total`}
        </p>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-3">
        <StatChip label="Válidas"   value={stats.validas}   color="#16A34A" />
        <StatChip label="Dudosas"   value={stats.dudosas}   color="#CA8A04" />
        <StatChip label="Excluidas" value={stats.excluir}   color="#DC2626" />
        <StatChip label="Pendientes" value={stats.pendientes} color="#9CA3AF" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Etiqueta</label>
          <select
            value={filter.etiqueta}
            onChange={(e) => setFilter((f) => ({ ...f, etiqueta: e.target.value as ImageAuditLabel | "" }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          >
            <option value="">Todas</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="VALIDA_ENTRENAMIENTO">Válida para entrenamiento</option>
            <option value="DUDOSA">Dudosa</option>
            <option value="EXCLUIR">Excluir</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Veredicto IA</label>
          <select
            value={filter.ia_correcta}
            onChange={(e) => setFilter((f) => ({ ...f, ia_correcta: e.target.value as "true" | "false" | "" }))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 transition"
          >
            <option value="">Todos</option>
            <option value="true">IA correcta</option>
            <option value="false">IA incorrecta</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => setFilter({ etiqueta: "", ia_correcta: "" })}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : imagenes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-16">
          <svg className="h-12 w-12 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18" />
          </svg>
          <p className="text-sm text-slate-500">Sin imágenes con los filtros aplicados</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {imagenes.map((img) => (
            <ImageCard key={img.incident_id} img={img} onLabel={handleLabel} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            disabled={pagination.page <= 1 || loading}
            onClick={() => void load(pagination.page - 1)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
          >
            ← Anterior
          </button>
          <span className="text-sm text-slate-500">
            Página {pagination.page} de {pagination.pages}
          </span>
          <button
            disabled={pagination.page >= pagination.pages || loading}
            onClick={() => void load(pagination.page + 1)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
