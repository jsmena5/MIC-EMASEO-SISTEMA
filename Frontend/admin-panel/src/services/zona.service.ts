import { API_URL } from "../config/env"
import { authenticatedFetch } from "../shared/api/authenticatedFetch"
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson"

export interface Zona {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  activa: boolean
  created_at: string
  supervisor_id: string | null
  supervisor_nombre: string | null
  supervisor_email: string | null
  geom: Polygon | MultiPolygon | null
}

export interface UpdateZonaPayload {
  nombre?: string
  descripcion?: string
  supervisor_id?: string | null
  activa?: boolean
}

export const listZonas = async (): Promise<{ zonas: Zona[] }> => {
  const res = await authenticatedFetch(`${API_URL}/users/zonas`)
  if (!res.ok) throw new Error("Error al obtener zonas")
  return res.json()
}

export const updateZona = async (id: string, data: UpdateZonaPayload): Promise<{ zona: Zona }> => {
  const res = await authenticatedFetch(`${API_URL}/users/zonas/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al actualizar zona")
  }
  return res.json()
}

export const deleteZona = async (
  id: string,
): Promise<{ deleted: boolean; zona: { codigo: string; nombre: string } }> => {
  const res = await authenticatedFetch(`${API_URL}/users/zonas/${id}`, {
    method: "DELETE",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al eliminar zona")
  }
  return res.json()
}

export const importZonas = async (
  features: Feature<Polygon | MultiPolygon>[],
): Promise<{ zonas: Zona[]; imported: number; incidentes_rezonificados?: number }> => {
  const res = await authenticatedFetch(`${API_URL}/users/zonas/import`, {
    method: "POST",
    body: JSON.stringify({ features }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al importar zonas")
  }
  return res.json()
}

export interface RezonificarOpts {
  /** Solo reasigna incidentes sin zona (zona_id NULL); no re-mueve el resto. */
  soloHuerfanos?: boolean
  /** No escribe; solo cuenta cuántos incidentes cambiarían. */
  dryRun?: boolean
}

export interface RezonificarResult {
  dry_run?: boolean
  solo_huerfanos: boolean
  /** Presente cuando dry_run=true: cuántos cambiarían. */
  incidentes_a_rezonificar?: number
  /** Presente cuando se aplica: cuántos se reasignaron. */
  incidentes_rezonificados?: number
}

/**
 * Recalcula la zona_id de los incidentes según la geometría actual de las zonas,
 * replicando el trigger fn_assign_zone (ST_Covers + zona más específica).
 * Pensado para correr tras editar/mover polígonos de zonas existentes.
 */
export const rezonificarIncidentes = async (
  { soloHuerfanos = false, dryRun = false }: RezonificarOpts = {},
): Promise<RezonificarResult> => {
  const params = new URLSearchParams()
  if (soloHuerfanos) params.set("solo_huerfanos", "true")
  if (dryRun)        params.set("dry_run", "true")
  const qs = params.toString()
  const res = await authenticatedFetch(`${API_URL}/users/zonas/rezonificar${qs ? `?${qs}` : ""}`, {
    method: "POST",
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al re-zonificar incidentes")
  }
  return res.json()
}

// ── Tipos para el mapa de incidentes ─────────────────────────────────────────

export interface ZonaProperties {
  id: string
  codigo: string
  nombre: string
  supervisor: string | null
  supervisor_email: string | null
  incidentes_activos: number
  pendientes: number
  en_atencion: number
  criticas: number
  ultimas_24h: number
  nivel: string
}

export interface IncidenteMapa {
  id: string
  estado: string
  prioridad: string | null
  descripcion: string | null
  zona_id: string | null
  zona_nombre: string | null
  created_at: string
  latitud: number
  longitud: number
}

export interface MapaZonasResponse {
  zonas: FeatureCollection
  incidentes: IncidenteMapa[]
  generado_at: string
}

export const getMapaZonas = async (): Promise<MapaZonasResponse> => {
  const res = await authenticatedFetch(`${API_URL}/supervisor/zonas/mapa`)
  if (!res.ok) throw new Error('Error al obtener mapa de zonas')
  return res.json()
}

export const getConfig = async (clave: string): Promise<{ valor: string }> => {
  const res = await authenticatedFetch(`${API_URL}/users/config/${clave}`)
  if (!res.ok) throw new Error("Error al obtener configuración")
  return res.json()
}

export const setConfig = async (clave: string, valor: string): Promise<void> => {
  const res = await authenticatedFetch(`${API_URL}/users/config/${clave}`, {
    method: "PUT",
    body: JSON.stringify({ valor }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? "Error al guardar configuración")
  }
}
