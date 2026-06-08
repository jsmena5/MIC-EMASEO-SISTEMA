/**
 * FiltersBar — barra de filtros compacta estilo Linear.
 * Los chips de acceso rápido siempre visibles.
 * Los filtros avanzados (dropdowns, fechas) se expanden solo cuando se necesitan.
 */
import { useState } from "react"
import type { DecisionAutomatica, IncidentEstado, Prioridad } from "../../services/incident.service"
import type { IncidentFilters } from "../../services/incident.service"
import { palette } from "./styles"

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

function Chip({ label, active, onClick, color }: {
  label: string; active: boolean; onClick: () => void; color: string
}) {
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
}: { filters: IncidentFilters; onChange: (f: IncidentFilters) => void }) {
  const [expanded, setExpanded] = useState(false)
  const set = (partial: Partial<IncidentFilters>) => onChange({ ...filters, ...partial, page: 1 })
  const active = hasActiveFilters(filters)

  return (
    <div style={{ background: "#fff", border: `1px solid #E2E8F0`, borderRadius: 14, padding: "10px 14px" }}>
      {/* ── Fila 1: chips de acceso rápido + toggle filtros avanzados ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip label="Por validar"     active={filters.estado === "PENDIENTE"}   onClick={() => set({ estado: filters.estado === "PENDIENTE"   ? "" : "PENDIENTE" })}   color={palette.warning} />
        <Chip label="En revisión IA"  active={filters.estado === "EN_REVISION"} onClick={() => set({ estado: filters.estado === "EN_REVISION" ? "" : "EN_REVISION" })} color="#C2410C" />
        <Chip label="Descartados"     active={filters.estado === "DESCARTADO"}  onClick={() => set({ estado: filters.estado === "DESCARTADO"  ? "" : "DESCARTADO" })}  color={palette.muted} />
        <Chip label="IA incorrecta"   active={Boolean(filters.ia_incorrecta)}   onClick={() => set({ ia_incorrecta: !filters.ia_incorrecta })}                          color={palette.danger} />
        <Chip label="Sin validar"     active={Boolean(filters.sin_supervisar)}  onClick={() => set({ sin_supervisar: !filters.sin_supervisar })}                        color={palette.primary} />

        <div className="ml-auto flex items-center gap-2">
          {active && (
            <button onClick={() => onChange({ page: 1, limit: filters.limit })}
              style={{ padding: "5px 11px", borderRadius: 999, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              ✕ Limpiar
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)}
            style={{ padding: "5px 11px", borderRadius: 999, border: `1px solid ${expanded ? palette.primary : "#E2E8F0"}`, background: expanded ? "#EBF4FF" : "#fff", color: expanded ? palette.primary : "#64748B", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="18" x2="12" y2="18"/>
            </svg>
            Filtros
          </button>
        </div>
      </div>

      {/* ── Fila 2: filtros avanzados (colapsables) ── */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-100 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <select value={filters.estado ?? ""} onChange={(e) => set({ estado: (e.target.value as IncidentEstado) || "" })} style={fieldStyle}>
            <option value="">Todos los estados</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="REVISADO">Revisado</option>
            <option value="EN_ATENCION">En atención</option>
            <option value="EN_REVISION">En revisión</option>
            <option value="RESUELTA">Resuelta</option>
            <option value="RECHAZADA">Rechazada</option>
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
