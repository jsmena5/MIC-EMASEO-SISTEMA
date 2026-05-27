// Paleta y estilos comunes — extraídos del antiguo Reports.tsx.
// Mantengo CSS-in-JS para no migrar 1500 líneas a Tailwind de golpe;
// la mayor parte de los componentes nuevos sí usa Tailwind.

import type { CSSProperties } from "react"

export const palette = {
  primary:       "#005BAC",
  primaryDark:   "#003F7A",
  primarySoft:   "#EBF4FF",
  secondary:     "#00A859",
  secondarySoft: "#E6F7EF",
  bg:            "#F0F4F8",
  card:          "#FFFFFF",
  text:          "#0F172A",
  muted:         "#475569",
  faint:         "#94A3B8",
  border:        "#E2E8F0",
  warning:       "#D97706",
  warningSoft:   "#FFF7ED",
  danger:        "#DC2626",
  dangerSoft:    "#FEF2F2",
}

export const ESTADO_STYLE: Record<string, { bg: string; text: string }> = {
  PROCESANDO:  { bg: "#DBEAFE", text: "#1D4ED8" },
  PENDIENTE:   { bg: "#FEF3C7", text: "#B45309" },
  EN_ATENCION: { bg: "#EDE9FE", text: "#6D28D9" },
  RESUELTA:    { bg: "#DCFCE7", text: "#166534" },
  RECHAZADA:   { bg: "#FEE2E2", text: "#991B1B" },
  FALLIDO:     { bg: "#FCE7F3", text: "#BE185D" },
  EN_REVISION: { bg: "#FFF7ED", text: "#C2410C" },
  DESCARTADO:  { bg: "#F1F5F9", text: "#475569" },
}

export const DECISION_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  ERROR_TECNICO:      { bg: "#FEE2E2", text: "#991B1B", label: "Error técnico" },
  RECHAZO_CONFIABLE:  { bg: "#F1F5F9", text: "#475569", label: "Rechazo confiable" },
  REVISION_REQUERIDA: { bg: "#FFF7ED", text: "#C2410C", label: "Revisión requerida" },
  INCIDENTE_VALIDO:   { bg: "#DCFCE7", text: "#166534", label: "Incidente válido" },
}

export const PRIORIDAD_STYLE: Record<string, { dot: string; label: string }> = {
  CRITICA: { dot: "#DC2626", label: "Crítica" },
  ALTA:    { dot: "#EA580C", label: "Alta" },
  MEDIA:   { dot: "#CA8A04", label: "Media" },
  BAJA:    { dot: "#16A34A", label: "Baja" },
}

export const NIVEL_LABEL: Record<string, string> = {
  BAJO:    "Bajo",
  MEDIO:   "Medio",
  ALTO:    "Alto",
  CRITICO: "Crítico",
}

export const TIPO_LABEL: Record<string, string> = {
  DOMESTICO:  "Doméstico",
  ORGANICO:   "Orgánico",
  RECICLABLE: "Reciclable",
  ESCOMBROS:  "Escombros",
  PELIGROSO:  "Peligroso",
  MIXTO:      "Mixto",
  OTRO:       "Otro",
}

export const fieldStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: `1px solid ${palette.border}`,
  padding: "10px 12px",
  fontSize: 14,
  color: palette.text,
  background: "#fff",
  outline: "none",
  boxSizing: "border-box",
}

export const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: palette.faint,
}

export const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 12,
  background: palette.primary,
  color: "#fff",
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 800,
  cursor: "pointer",
}

export const ghostButtonStyle: CSSProperties = {
  border: `1px solid ${palette.border}`,
  borderRadius: 12,
  background: "#fff",
  color: palette.muted,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
}

export const fmtDate = (value: string | null) => {
  if (!value) return "Sin fecha"
  return new Date(value).toLocaleString("es-EC", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

export const fmtPercent = (value: number | string | null) => {
  if (value == null) return "Sin dato"
  const n = Number(value)
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : "Sin dato"
}

export const fmtVolume = (value: number | string | null) => {
  if (value == null) return "Sin dato"
  const n = Number(value)
  return Number.isFinite(n) ? `${n.toFixed(2)} m³` : "Sin dato"
}
