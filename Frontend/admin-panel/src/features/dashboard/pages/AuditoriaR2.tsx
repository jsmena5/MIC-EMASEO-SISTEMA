import { useCallback, useEffect, useState } from "react"
import { listImagenes, etiquetarImagen } from "../../../services/auditoria.service"
import type { ImagenAuditoria, ImageAuditLabel } from "../../../services/auditoria.service"
import { toPublicMediaUrl } from "../../../shared/api/mediaUrl"

// ─── Config de etiquetas ─────────────────────────────────────────────────────
// "VALIDA_ENTRENAMIENTO" = útil para el dataset (puede tener o NO tener basura:
// ambos casos sirven como ejemplo positivo o negativo para el modelo).
// "EXCLUIR" = borrosa, duplicada o sin valor alguno para el dataset.

const ETIQUETA_CFG: Record<ImageAuditLabel, {
  label: string; sublabel: string; color: string; bg: string; dot: string; icon: string
}> = {
  PENDIENTE:            { label: "Sin clasificar", sublabel: "",                              color: "#9CA3AF", bg: "#F9FAFB", dot: "#D1D5DB", icon: "·"  },
  VALIDA_ENTRENAMIENTO: { label: "Útil para IA",   sublabel: "Sirve como ejemplo (+ o −)",   color: "#16A34A", bg: "#F0FDF4", dot: "#22C55E", icon: "✓"  },
  DUDOSA:               { label: "Dudosa",          sublabel: "Revisar después",              color: "#CA8A04", bg: "#FEFCE8", dot: "#EAB308", icon: "?"  },
  EXCLUIR:              { label: "No sirve",        sublabel: "Borrosa, duplicada o sin valor", color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444", icon: "✗"  },
}

const NIVEL_COLOR: Record<string, string> = {
  BAJO: "#16A34A", MEDIO: "#CA8A04", ALTO: "#EA580C", CRITICO: "#DC2626",
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: Readonly<{ url: string; onClose: () => void }>) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    globalThis.window.addEventListener("keydown", h)
    return () => globalThis.window.removeEventListener("keydown", h)
  }, [onClose])

  return (
    <div aria-hidden="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}>
      <button className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white text-xl hover:bg-white/30"
        onClick={onClose}>✕</button>
      <img src={url} alt="Evidencia ampliada"
        className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain shadow-2xl" />
    </div>
  )
}

// ─── Image card ───────────────────────────────────────────────────────────────

function ImageCard({
  img, onLabel, onRemove,
}: Readonly<{
  img: ImagenAuditoria
  onLabel: (id: string, etiqueta: ImageAuditLabel) => void
  onRemove: (id: string) => void
}>) {
  const [saving,       setSaving]       = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const cfg      = ETIQUETA_CFG[img.etiqueta]
  const imageUrl = toPublicMediaUrl(img.image_url)

  const handleLabel = async (etiqueta: ImageAuditLabel) => {
    if (saving || img.etiqueta === etiqueta) return
    setSaving(true)
    try {
      await etiquetarImagen(img.incident_id, etiqueta)
      onLabel(img.incident_id, etiqueta)
      // Si la vista solo muestra PENDIENTE, sacar la card inmediatamente
      setTimeout(() => onRemove(img.incident_id), 400)
    } catch { /* silent */ }
    finally { setSaving(false) }
  }

  return (
    <>
      <div
        className={[
          "rounded-2xl border bg-white overflow-hidden shadow-sm transition-all duration-300",
          saving ? "opacity-50 scale-95" : "hover:shadow-md",
        ].join(" ")}
        style={{ borderColor: cfg.color + "40" }}
      >
        {/* Imagen — click abre lightbox */}
        <button type="button" className="relative bg-slate-900 cursor-zoom-in w-full" style={{ height: 180 }}
          onClick={() => imageUrl && setLightboxOpen(true)}>
          {imageUrl ? (
            <img src={imageUrl} alt="Evidencia"
              className="h-full w-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <svg className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18" />
              </svg>
            </div>
          )}
          {/* Estado del incidente */}
          <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm">
            {img.estado.replaceAll("_", " ")}
          </span>
          {/* Veredicto IA supervisor */}
          {img.ia_fue_correcta != null && (
            <span className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm ${
              img.ia_fue_correcta ? "bg-emerald-500/80 text-white" : "bg-red-500/80 text-white"
            }`}>
              IA {img.ia_fue_correcta ? "✓" : "✗"}
            </span>
          )}
          {/* Hint de ampliar */}
          {imageUrl && (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[9px] text-white">🔍</span>
          )}
        </button>

        {/* Meta IA */}
        <div className="px-3 pt-2 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {img.tipo_residuo && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-slate-600 bg-slate-100">
                {img.tipo_residuo}
              </span>
            )}
            {img.nivel_acumulacion && (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                style={{ color: NIVEL_COLOR[img.nivel_acumulacion] ?? "#6B7280", background: (NIVEL_COLOR[img.nivel_acumulacion] ?? "#6B7280") + "18" }}>
                {img.nivel_acumulacion}
              </span>
            )}
            {img.confianza != null && (
              <span className="text-[10px] text-slate-400">{Math.round(img.confianza * 100)}%</span>
            )}
          </div>
          {(img.tipo_residuo_supervisor || img.nivel_acumulacion_supervisor) && (
            <div className="mt-1 text-[10px] text-emerald-600 font-semibold">
              Correc. sup.: {img.tipo_residuo_supervisor ?? ""} {img.nivel_acumulacion_supervisor ?? ""}
            </div>
          )}
          {/* Etiqueta actual */}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: cfg.dot }} />
            <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
          </div>
        </div>

        {/* Botones de etiquetado — 3 opciones claras */}
        <div className="grid grid-cols-3 gap-1 px-3 pb-3 pt-1">
          {(["VALIDA_ENTRENAMIENTO", "DUDOSA", "EXCLUIR"] as ImageAuditLabel[]).map((e) => {
            const c = ETIQUETA_CFG[e]
            const active = img.etiqueta === e
            return (
              <button key={e} disabled={saving} onClick={() => void handleLabel(e)}
                title={`${c.label} — ${c.sublabel}`}
                className="flex flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-bold transition disabled:opacity-50"
                style={{
                  background: active ? c.color : c.bg,
                  color:      active ? "#fff"  : c.color,
                  border:     `1px solid ${c.color}40`,
                }}>
                <span className="text-base leading-none">{c.icon}</span>
                <span className="text-[10px]">{c.label.split(" ")[0]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {lightboxOpen && imageUrl && (
        <Lightbox url={imageUrl} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  )
}


// ─── Page ─────────────────────────────────────────────────────────────────────

type FilterEtiqueta = ImageAuditLabel | ""
type FilterIA = "true" | "false" | ""

export default function AuditoriaR2() {
  const [imagenes,   setImagenes]   = useState<ImagenAuditoria[]>([])
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 24, pages: 1 })
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState("")
  // Por defecto: solo sin clasificar → el admin ve exactamente qué falta revisar
  const [etiqueta,   setEtiqueta]   = useState<FilterEtiqueta>("PENDIENTE")
  const [iaCorrecta, setIaCorrecta] = useState<FilterIA>("")

  const load = useCallback(async (page = 1, et = etiqueta, ia = iaCorrecta) => {
    setLoading(true); setError("")
    try {
      const res = await listImagenes({ page, limit: 24, etiqueta: et || undefined, ia_correcta: ia || undefined })
      setImagenes(res.imagenes)
      setPagination(res.pagination)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar")
    } finally {
      setLoading(false)
    }
  }, [etiqueta, iaCorrecta])

  useEffect(() => { load(1).catch(() => { /* errores ya gestionados en load */ }) }, [etiqueta, iaCorrecta, load])

  const handleLabel = useCallback((id: string, label: ImageAuditLabel) => {
    setImagenes((prev) => prev.map((img) => img.incident_id === id ? { ...img, etiqueta: label } : img))
  }, [])

  // Quita la card de la vista actual si el filtro es PENDIENTE (ya fue clasificada)
  const handleRemove = useCallback((id: string) => {
    if (etiqueta === "PENDIENTE") {
      setImagenes((prev) => prev.filter((img) => img.incident_id !== id))
    }
  }, [etiqueta])

  const totalPendiente = pagination.total

  return (
    <div className="flex flex-col gap-5">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-extrabold text-slate-900">Auditoría de imágenes</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Clasifica imágenes para mejorar el modelo IA · {!loading && `${totalPendiente} en esta vista`}
        </p>

        {/* Guía clara de etiquetas */}
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-slate-700 leading-relaxed">
          <span className="font-bold text-blue-800">Guía de clasificación:</span>
          {" "}Una imagen es <span className="font-bold text-green-700">Útil para IA</span> si documenta
          bien la escena — <em>tanto si tiene basura como si no</em>: ambas enseñan al modelo.
          {" "}<span className="font-bold text-amber-700">Dudosa</span> si no estás seguro.
          {" "}<span className="font-bold text-red-700">No sirve</span> si está borrosa, es duplicada o
          no aporta información — <em>estas son las más valiosas para corregir falsos positivos</em>.
        </div>
      </div>

      {/* ── Filtros como tabs ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          { value: "PENDIENTE",            label: "Sin clasificar" },
          { value: "VALIDA_ENTRENAMIENTO", label: "Útiles para IA" },
          { value: "DUDOSA",               label: "Dudosas"        },
          { value: "EXCLUIR",              label: "No sirven"      },
          { value: "",                     label: "Todas"          },
        ] as { value: FilterEtiqueta; label: string }[]).map(({ value, label }) => (
          <button key={value}
            onClick={() => { setEtiqueta(value) }}
            className={[
              "rounded-full border px-3 py-1.5 text-xs font-bold transition",
              etiqueta === value
                ? "border-[#005BAC] bg-[#005BAC] text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            ].join(" ")}>
            {label}
          </button>
        ))}

        <div className="ml-auto">
          <select value={iaCorrecta} onChange={(e) => setIaCorrecta(e.target.value as FilterIA)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:outline-none">
            <option value="">Todos los veredictos IA</option>
            <option value="true">IA correcta</option>
            <option value="false">IA incorrecta</option>
          </select>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* ── Grid de imágenes ──────────────────────────────────── */}
      {(() => {
        if (loading) {
          return (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => `skeleton-${i}`).map((key) => (
                <div key={key} className="h-64 rounded-2xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          )
        }
        if (imagenes.length === 0) {
          return (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-20">
              <div className="text-4xl">✓</div>
              <p className="text-sm font-bold text-slate-700">
                {etiqueta === "PENDIENTE" ? "¡Todo clasificado en esta página!" : "Sin imágenes con estos filtros"}
              </p>
              {etiqueta === "PENDIENTE" && pagination.pages > pagination.page && (
                <button onClick={() => { load(pagination.page + 1).catch(() => { /* errores ya gestionados en load */ }) }}
                  className="mt-1 rounded-xl bg-[#005BAC] px-4 py-2 text-sm font-bold text-white hover:bg-[#004B8E]">
                  Ver siguiente página →
                </button>
              )}
            </div>
          )
        }
        return (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {imagenes.map((img) => (
              <ImageCard key={img.incident_id} img={img} onLabel={handleLabel} onRemove={handleRemove} />
            ))}
          </div>
        )
      })()}

      {/* ── Paginación ─────────────────────────────────────────── */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button disabled={pagination.page <= 1 || loading}
            onClick={() => { load(pagination.page - 1).catch(() => { /* errores ya gestionados en load */ }) }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
            ← Anterior
          </button>
          <span className="text-sm text-slate-500 tabular-nums">
            {pagination.page} / {pagination.pages}
          </span>
          <button disabled={pagination.page >= pagination.pages || loading}
            onClick={() => { load(pagination.page + 1).catch(() => { /* errores ya gestionados en load */ }) }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}
