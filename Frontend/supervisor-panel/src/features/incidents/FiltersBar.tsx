import type {
  DecisionAutomatica,
  IncidentEstado,
  Prioridad,
} from "../../services/incident.service"
import type { IncidentFilters } from "../../services/incident.service"
import { fieldStyle, ghostButtonStyle, palette } from "./styles"

function hasActiveFilters(f: IncidentFilters) {
  return Boolean(
    f.estado || f.prioridad || f.decision_automatica ||
    f.fecha_desde || f.fecha_hasta || f.ia_incorrecta || f.sin_supervisar,
  )
}

function Chip({
  label, active, onClick, color,
}: { label: string; active: boolean; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 12px",
        borderRadius: 999,
        border: `1px solid ${active ? color : palette.border}`,
        background: active ? `${color}18` : "#fff",
        color: active ? color : palette.muted,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  )
}

export default function FiltersBar({
  filters, onChange,
}: { filters: IncidentFilters; onChange: (f: IncidentFilters) => void }) {
  const set = (partial: Partial<IncidentFilters>) =>
    onChange({ ...filters, ...partial, page: 1 })

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${palette.border}`,
        borderRadius: 16,
        padding: 14,
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Chip label="Por validar"           active={filters.estado === "PENDIENTE"}   onClick={() => set({ estado: filters.estado === "PENDIENTE" ? "" : "PENDIENTE" })}   color={palette.warning} />
        <Chip label="En revisión IA"        active={filters.estado === "EN_REVISION"} onClick={() => set({ estado: filters.estado === "EN_REVISION" ? "" : "EN_REVISION" })} color="#C2410C" />
        <Chip label="Descartados por IA"    active={filters.estado === "DESCARTADO"}  onClick={() => set({ estado: filters.estado === "DESCARTADO" ? "" : "DESCARTADO" })}  color={palette.muted} />
        <Chip label="IA marcada incorrecta" active={Boolean(filters.ia_incorrecta)}   onClick={() => set({ ia_incorrecta: !filters.ia_incorrecta })}                          color={palette.danger} />
        <Chip label="Sin validación humana" active={Boolean(filters.sin_supervisar)}  onClick={() => set({ sin_supervisar: !filters.sin_supervisar })}                        color={palette.primary} />
        {hasActiveFilters(filters) && (
          <button onClick={() => onChange({ page: 1, limit: filters.limit })} style={ghostButtonStyle}>
            Limpiar
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
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

        <select
          value={filters.decision_automatica ?? ""}
          onChange={(e) => set({ decision_automatica: (e.target.value as DecisionAutomatica) || "" })}
          style={fieldStyle}
        >
          <option value="">Todas las decisiones IA</option>
          <option value="INCIDENTE_VALIDO">Incidente válido</option>
          <option value="REVISION_REQUERIDA">Revisión requerida</option>
          <option value="RECHAZO_CONFIABLE">Rechazo confiable</option>
          <option value="ERROR_TECNICO">Error técnico</option>
        </select>

        <input type="date" value={filters.fecha_desde ?? ""} onChange={(e) => set({ fecha_desde: e.target.value || undefined })} style={fieldStyle} />
        <input type="date" value={filters.fecha_hasta ?? ""} onChange={(e) => set({ fecha_hasta: e.target.value || undefined })} style={fieldStyle} />
      </div>
    </div>
  )
}
