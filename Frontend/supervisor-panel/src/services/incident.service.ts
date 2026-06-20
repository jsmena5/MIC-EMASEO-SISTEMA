/**
 * incident.service.ts
 *
 * Acceso a los endpoints del image-service (rutas /supervisor/* y /operario/feedback/*)
 * desde el panel del supervisor.
 *
 * Todos los valores vacíos/nulos se normalizan con ?? para evitar que el
 * consumidor tenga que manejar undefined.
 *
 * v2 (migración 032): agrega estados DESCARTADO y los campos decision_automatica,
 * confianza_decision e imagen_auditoria_url para soportar el flujo de revisión humana.
 *
 * v3 (migración 033): agrega revisión supervisada de decisiones IA:
 * ia_fue_correcta, nivel_acumulacion_supervisor, tipo_residuo_supervisor,
 * nota_supervision, supervisado_por/at. Nuevos filtros: fecha_desde,
 * fecha_hasta, decision_automatica, ia_incorrecta, sin_supervisar.
 */

import { API_URL } from '../config/env'
import { authenticatedFetch } from '../shared/api/authenticatedFetch'

// ─── Tipos ────────────────────────────────────────────────────────────────────

// Tipos del dominio consolidados en src/types/incident.ts.
// Se reexportan para que los componentes existentes sigan importando desde aquí.
export type {
  DecisionAutomatica,
  IncidentEstado,
  NivelAcum,
  Prioridad,
  TipoResiduo,
} from '../types/incident'

import type {
  DecisionAutomatica,
  IncidentEstado,
  NivelAcum,
  Prioridad,
  TipoResiduo,
} from '../types/incident'

export interface IncidentListItem {
  id: string
  estado: IncidentEstado
  prioridad: Prioridad | null
  nota_fallo: string | null
  /** Tipo estructurado de decisión automática (null en incidentes pre-032) */
  decision_automatica: DecisionAutomatica | null
  /** Confianza del ML al tomar la decisión (0-1, null si no aplica) */
  confianza_decision: number | null
  /** URL S3 de la imagen preservada para auditoría en casos FALLIDO/DESCARTADO */
  imagen_auditoria_url: string | null
  descripcion: string | null
  direccion: string | null
  created_at: string
  updated_at: string
  resuelto_at: string | null
  latitud: number
  longitud: number
  zona_id: string | null
  zona_nombre: string | null
  ciudadano_nombre: string | null
  ciudadano_cedula: string | null
  /** URL de imagen principal (solo en incidentes PENDIENTE/EN_ATENCION/RESUELTA) */
  image_url: string | null
  nivel_acumulacion: NivelAcum | null
  tipo_residuo: TipoResiduo | null
  volumen_estimado_m3: number | null
  confianza: number | null
  asignaciones_activas: number
  /** Número de detecciones en el resultado ML (033) */
  num_detecciones: number | null
  /** Veredicto supervisado: true=IA correcta, false=incorrecta, null=sin revisar (033) */
  ia_fue_correcta: boolean | null
  /** Timestamp de la última revisión supervisora (033) */
  supervisado_at: string | null
}

export interface FeedbackItem {
  id: string
  es_correcta: boolean
  comentario: string | null
  created_at: string
  updated_at: string
  reportado_por_username: string
  reportado_por_rol: string
}

export interface FeedbackResumen {
  total: number
  correctos: number
  incorrectos: number
  consenso_correcto: boolean | null
  detalle: FeedbackItem[]
}

export interface HistorialItem {
  estado_anterior: string
  estado_nuevo: string
  observaciones: string | null
  created_at: string
  actor: string
  actor_rol: string
}

export interface AsignacionItem {
  id: string
  completada: boolean
  fecha_esperada: string | null
  notas: string | null
  created_at: string
  operario_nombre: string
  operario_cedula: string | null
}

export interface IncidentDetail extends IncidentListItem {
  zona_codigo: string | null
  ciudadano_email: string | null
  modelo_nombre: string | null
  /** Raw JSONB de detecciones ML: [{class, confidence, bbox:[x1,y1,x2,y2], ...}] */
  detecciones: DeteccionItem[] | null
  tiempo_inferencia_ms: number | null
  analizado_at: string | null
  historial: HistorialItem[]
  asignaciones: AsignacionItem[]
  /** Resumen de feedback de IA de operarios/supervisores */
  feedback_ia: FeedbackResumen

  // ── Correcciones supervisoras (migración 033) ───────────────────────────
  /** Nivel de acumulación corregido por el supervisor (null = sin corrección) */
  nivel_acumulacion_supervisor: NivelAcum | null
  /** Tipo de residuo corregido por el supervisor (null = sin corrección) */
  tipo_residuo_supervisor: TipoResiduo | null
  /** Veredicto firmado del supervisor sobre la precisión del ML */
  ia_fue_correcta: boolean | null
  /** Nota de auditoría libre del supervisor */
  nota_supervision: string | null
  /** UUID del supervisor que realizó la última revisión */
  supervisado_por: string | null
  /** Username legible del supervisor para mostrar en UI */
  supervisado_por_username: string | null
  /** Timestamp de la última revisión */
  supervisado_at: string | null
}

/** Estructura de cada detección individual en el JSONB de ML */
export interface DeteccionItem {
  class?: string
  confidence?: number
  bbox?: [number, number, number, number]
  [key: string]: unknown  // campos adicionales del modelo
}

export interface OperarioItem {
  id: string
  nombre_completo: string
  cedula: string | null
  cargo: string | null
  telefono: string | null
  zona_nombre: string | null
  asignaciones_activas: number
}

export interface IncidentListResponse {
  incidents: IncidentListItem[]
  pagination: {
    total: number
    page: number
    limit: number
    pages: number
  }
}

// ─── Filtros para listado (migración 033: fecha, decision_automatica, ia_incorrecta) ──

export type SortOrder = 'priority' | 'newest'

export interface IncidentFilters {
  estado?: IncidentEstado | ''
  prioridad?: Prioridad | ''
  zona_id?: string
  decision_automatica?: DecisionAutomatica | ''
  fecha_desde?: string      // ISO date YYYY-MM-DD
  fecha_hasta?: string      // ISO date YYYY-MM-DD
  ia_incorrecta?: boolean   // solo incidentes donde supervisor marcó IA incorrecta
  sin_supervisar?: boolean  // solo incidentes con ML sin revisar aún
  sort?: SortOrder          // 'priority' (default) | 'newest'
  page?: number
  limit?: number
}

// ─── Payload para la revisión supervisada (migración 033) ────────────────────

export interface RevisionIAPayload {
  es_correcta_ia: boolean
  comentario?: string | null
  nivel_acumulacion_supervisor?: NivelAcum | null
  tipo_residuo_supervisor?: TipoResiduo | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildQuery(filters: IncidentFilters): string {
  const params = new URLSearchParams()
  if (filters.estado)              params.set('estado',              filters.estado)
  if (filters.prioridad)           params.set('prioridad',           filters.prioridad)
  if (filters.zona_id)             params.set('zona_id',             filters.zona_id)
  if (filters.decision_automatica) params.set('decision_automatica', filters.decision_automatica)
  if (filters.fecha_desde)         params.set('fecha_desde',         filters.fecha_desde)
  if (filters.fecha_hasta)         params.set('fecha_hasta',         filters.fecha_hasta)
  if (filters.ia_incorrecta)       params.set('ia_incorrecta',       'true')
  if (filters.sin_supervisar)      params.set('sin_supervisar',      'true')
  if (filters.sort)                params.set('sort',                filters.sort)
  if (filters.page)                params.set('page',                String(filters.page))
  if (filters.limit)               params.set('limit',               String(filters.limit))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

async function handleResponse<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    let message = `Error ${res.status}`
    try {
      const body = await res.json()
      message = body?.error ?? message
    } catch (err) {
      if (import.meta.env.DEV) console.warn(`[incident.service] no se pudo parsear el body de error (${context}):`, err)
    }
    throw new Error(`[incident.service] ${context}: ${message}`)
  }
  return res.json() as Promise<T>
}

// ─── API calls ────────────────────────────────────────────────────────────────

/** GET /supervisor/incidents — lista paginada con filtros opcionales */
export async function getIncidents(filters: IncidentFilters = {}): Promise<IncidentListResponse> {
  const qs  = buildQuery(filters)
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents${qs}`)
  return handleResponse<IncidentListResponse>(res, 'getIncidents')
}

/** GET /supervisor/incidents/:id — detalle completo con historial, asignaciones, feedback IA y correcciones supervisoras */
export async function getIncidentDetail(id: string): Promise<IncidentDetail> {
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents/${id}`)
  return handleResponse<IncidentDetail>(res, `getIncidentDetail(${id})`)
}

/** PUT /supervisor/incidents/:id/estado — cambia estado con transición validada */
export async function cambiarEstado(
  id: string,
  estado: IncidentEstado,
  extra?: { motivo_rechazo?: import('../types/incident').MotivoRechazo; observaciones?: string } | string,
  gps?: { cierre_lat: number; cierre_lon: number },
): Promise<{ message: string; incident_id: string; estado: IncidentEstado; distancia_cierre_m?: number }> {
  const body = typeof extra === 'string'
    ? { estado, observaciones: extra, ...gps }
    : { estado, ...extra, ...gps }
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents/${id}/estado`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  })
  return handleResponse(res, `cambiarEstado(${id} → ${estado})`)
}

/** POST /supervisor/incidents/:id/asignar — asigna incidente a un operario */
export async function asignarIncidente(
  id: string,
  operario_id: string,
  fecha_esperada?: string | null,
  notas?: string | null,
): Promise<{ message: string; assignment_id: string; incident_id: string; operario_id: string }> {
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents/${id}/asignar`, {
    method: 'POST',
    body:   JSON.stringify({ operario_id, fecha_esperada: fecha_esperada ?? null, notas: notas ?? null }),
  })
  return handleResponse(res, `asignarIncidente(${id})`)
}

/**
 * PUT /supervisor/incidents/:id/revision-ia
 *
 * Registra el veredicto supervisado del análisis IA. Idempotente — puede
 * llamarse múltiples veces para actualizar la revisión.
 *
 * Audita en ai.analysis_feedback (pipeline de drift) y en ai.analysis_results
 * (correcciones estructuradas con autoría del supervisor).
 */
export async function revisionIA(
  id: string,
  payload: RevisionIAPayload,
): Promise<{
  message: string
  incident_id: string
  analysis_result_id: string | null
  es_correcta_ia: boolean
  nivel_acumulacion_supervisor: NivelAcum | null
  tipo_residuo_supervisor: TipoResiduo | null
}> {
  const res = await authenticatedFetch(`${API_URL}/supervisor/incidents/${id}/revision-ia`, {
    method: 'PUT',
    body:   JSON.stringify(payload),
  })
  return handleResponse(res, `revisionIA(${id})`)
}

/** GET /supervisor/operarios — lista de operarios activos para dropdown */
export async function getOperarios(): Promise<{ operarios: OperarioItem[] }> {
  const res = await authenticatedFetch(`${API_URL}/supervisor/operarios`)
  return handleResponse(res, 'getOperarios')
}
