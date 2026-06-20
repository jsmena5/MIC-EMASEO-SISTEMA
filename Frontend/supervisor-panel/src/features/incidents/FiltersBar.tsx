/**
 * FiltersBar — barra de filtros compacta estilo Linear.
 * Los chips de acceso rápido siempre visibles.
 * Los filtros avanzados (dropdowns, fechas) se expanden solo cuando se necesitan.
 */
import { useState } from "react"
import type { DecisionAutomatica, IncidentEstado, IncidentFilters, Prioridad } from "../../services/incident.service"
import { palette } from "./styles"
import { SlidersHorizontal, X } from "lucide-react"

function hasActiveFilters(f: IncidentFilters) {
  return Boolean(f.estado || f.prioridad || f.decision_automatica || f.fecha_desde || f.fecha_hasta || f.ia_incorrecta || f.sin_supervisar)
}

const fieldStyle: React.CSSProperties = {
  borderRadius: 8,
  border: `1px solid #E2E8F0`,
  padding: "7px 10px",
  fontSize: 12,
  color: "#0F172A",
  background: "#fff",
  outline: "none",
  width: "100%",
}

function Chip({ label, active, onClick, color }: Readonly<{
  label: string; active: boolean; onClick: () => void; color: string
}>) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 11px", borderRadius: 999,
      border: `1px solid ${active ? color : "#E2E8F0"}`,
      background: active ? `${color}18` : "#fff",
      color: active ? color : "#64748B",
      fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
    }}>
      {label}
    </button>
  )
}

export default function FiltersBar({
  filters, onChange,
}: Readonly<{ filters: IncidentFilters; onChange: (f: IncidentFilters) => void }>) {
  const [expanded, setExpanded] = useState(false)
  const set = (partial: Partial<IncidentFilters>) => onChange({ ...filters, ...partial, page: 1 })
  const active = hasActiveFilters(filters)

  return (
    <div style={{ background: "#fff", border: `1px solid #E2E8F0`, borderRadius: 14, padding: "10px 14px" }}>
      {/* ── Chips de acceso rápido — fila horizontal con scroll en móvil ──
           El gradiente derecho indica visualmente que hay más chips al deslizar ── */}
      <div className="relative">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label="Entrantes"   active={Boolean(filters.sin_supervisar)}  onClick={() => set({ sin_supervisar: !filters.sin_supervisar, estado: "" })}              color={palette.primary} />
        <Chip label="Pendientes"  active={filters.estado === "PENDIENTE"}   onClick={() => set({ estado: filters.estado === "PENDIENTE"  ? "" : "PENDIENTE",  sin_supervisar: false })} color={palette.warning} />
        <Chip label="Válidos"     active={filters.estado === "VALIDO"}      onClick={() => set({ estado: filters.estado === "VALIDO"     ? "" : "VALIDO",     sin_supervisar: false })} color="#0369A1" />
        <Chip label="En atención" active={filters.estado === "EN_ATENCION"} onClick={() => set({ estado: filters.estado === "EN_ATENCION"? "" : "EN_ATENCION",sin_supervisar: false })} color="#6D28D9" />
        <Chip label="Descartados" active={filters.estado === "DESCARTADO"}  onClick={() => set({ estado: filters.estado === "DESCARTADO" ? "" : "DESCARTADO", sin_supervisar: false })} color={palette.muted} />
        <Chip label="IA incorrecta" active={Boolean(filters.ia_incorrecta)} onClick={() => set({ ia_incorrecta: !filters.ia_incorrecta })}                               color={palette.danger} />

        {/* Separador y acciones — shrink-0 para que no se compriman */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {active && (
            <button onClick={() => onChange({ page: 1, limit: filters.limit })}
              style={{ padding: "5px 11px", borderRadius: 999, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
              <X size={11} /> Limpiar
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${expanded ? palette.primary : "#E2E8F0"}`, background: expanded ? palette.primarySoft : "#fff", color: expanded ? palette.primary : "#64748B", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
            <SlidersHorizontal size={12} />
            <span className="hidden sm:inline">Filtros</span>
          </button>
        </div>
      </div>
      {/* Gradiente que indica chips adicionales al deslizar */}
      <div className="pointer-events-none absolute right-0 top-0 h-full w-8 bg-gradient-to-l from-white sm:hidden" />
      </div>

      {/* ── Fila 2: filtros avanzados (colapsables) ── */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <select value={filters.estado ?? ""} onChange={(e) => set({ estado: (e.target.value as IncidentEstado) || "" })} style={fieldStyle}>
            <option value="">Todos los estados</option>
            <option value="PROCESANDO">Procesando</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="VALIDO">Válido</option>
            <option value="EN_ATENCION">En atención</option>
            <option value="RESUELTA">Resuelta</option>
            <option value="RECHAZADO">Rechazado</option>
            <option value="DESCARTADO">Descartado</option>
            <option value="FALLIDO">Fallido</option>
          </select>

          <select value={filters.prioridad ?? ""} onChange={(e) => set({ prioridad: (e.target.value as Prioridad) || "" })} style={fieldStyle}>
            <option value="">Todas las prioridades</option>
            <option value="CRITICA">Crítica</option>
            <option value="ALTA">Alta</option>
            <option value="MEDIA">Media</option>
            <option value="BAJA">Baja</option>
          </select>

          <select value={filters.decision_automatica ?? ""} onChange={(e) => set({ decision_automatica: (e.target.value as DecisionAutomatica) || "" })} style={fieldStyle}>
            <option value="">Todas las decisiones IA</option>
            <option value="INCIDENTE_VALIDO">Incidente válido</option>
            <option value="REVISION_REQUERIDA">Revisión requerida</option>
            <option value="RECHAZO_CONFIABLE">Rechazo confiable</option>
            <option value="ERROR_TECNICO">Error técnico</option>
          </select>

          <input type="date" value={filters.fecha_desde ?? ""} onChange={(e) => set({ fecha_desde: e.target.value || undefined })} style={fieldStyle} />
          <input type="date" value={filters.fecha_hasta ?? ""} onChange={(e) => set({ fecha_hasta: e.target.value || undefined })} style={fieldStyle} />
        </div>
      )}
    </div>
  )
}
