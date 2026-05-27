// ─────────────────────────────────────────────────────────────────────────────
// Tipos del dominio de incidencias (reflejan el esquema de las migraciones 032/033).
//
// NOTA: este archivo está duplicado a propósito en supervisor-panel/src/types/.
// Sin un monorepo, los builds aislados no pueden importar fuera del directorio del
// proyecto. Si cambias un tipo aquí, sincroniza el otro.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estados del ciclo de vida de una incidencia.
 *   PROCESANDO → PENDIENTE   (ML detectó residuos)
 *   PROCESANDO → EN_REVISION (ML dudoso → supervisor decide)
 *   PROCESANDO → DESCARTADO  (ML descartó con confianza)
 *   PROCESANDO → FALLIDO     (error técnico)
 *   EN_REVISION → PENDIENTE | RECHAZADA
 *   DESCARTADO  → PENDIENTE
 *   PENDIENTE   → EN_ATENCION | RECHAZADA
 *   EN_ATENCION → RESUELTA | RECHAZADA | PENDIENTE
 */
export type IncidentEstado =
  | 'PROCESANDO'
  | 'PENDIENTE'
  | 'EN_ATENCION'
  | 'RESUELTA'
  | 'RECHAZADA'
  | 'FALLIDO'
  | 'EN_REVISION'
  | 'DESCARTADO'

/** Subset usable como respuesta del análisis ML (excluye estados de error). */
export type AnalysisIncidentEstado = Extract<
  IncidentEstado,
  'PENDIENTE' | 'EN_ATENCION' | 'RESUELTA' | 'RECHAZADA'
>

/** Decisión estructurada del pipeline ML. */
export type DecisionAutomatica =
  | 'ERROR_TECNICO'
  | 'RECHAZO_CONFIABLE'
  | 'REVISION_REQUERIDA'
  | 'INCIDENTE_VALIDO'

export type Prioridad = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'

export type NivelAcum = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO'

export type TipoResiduo =
  | 'DOMESTICO'
  | 'ORGANICO'
  | 'RECICLABLE'
  | 'ESCOMBROS'
  | 'PELIGROSO'
  | 'MIXTO'
  | 'OTRO'

/** Campos compartidos entre la vista del ciudadano (mobile) y el supervisor (web). */
export interface IncidentBase {
  id: string
  estado: IncidentEstado
  prioridad: Prioridad | null
  descripcion: string | null
  created_at: string
  image_url: string | null
  nivel_acumulacion: NivelAcum | null
  tipo_residuo: TipoResiduo | null
  confianza: number | null
  num_detecciones: number | null
  latitud?: number | null
  longitud?: number | null
}
