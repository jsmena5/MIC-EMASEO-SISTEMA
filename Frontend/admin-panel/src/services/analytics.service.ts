import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"

export interface ZonaStats {
  id: string
  codigo: string
  nombre: string
  total: number
  pendientes: number
  en_atencion: number
  resueltas: number
  rechazadas: number
  fallidas: number
  en_revision: number
  descartadas: number
  criticas: number
  volumen_promedio_m3: string | null
  confianza_promedio: string | null
  supervisor_nombre: string | null
}

export interface IncidentListItem {
  id: string
  estado: string
  prioridad: string | null
  zona_nombre: string | null
  ciudadano_nombre: string | null
  created_at: string
  latitud: number
  longitud: number
}

export interface IncidentListResponse {
  incidents: IncidentListItem[]
  pagination: { total: number; page: number; limit: number; pages: number }
}

export const getEstadisticasZonas = async (): Promise<{ zonas: ZonaStats[] }> => {
  const res = await authenticatedFetch(`${API_URL}/supervisor/zonas/estadisticas`)
  if (!res.ok) throw new Error("Error al obtener estadísticas")
  return res.json()
}

export const getIncidents = async (
  params: Record<string, string | number | undefined>,
): Promise<IncidentListResponse> => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) q.set(k, String(v))
  })
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents?${q}`)
  if (!res.ok) throw new Error("Error al obtener incidentes")
  return res.json()
}
