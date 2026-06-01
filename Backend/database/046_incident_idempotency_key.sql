-- ============================================================================
-- Migración 046: Idempotencia de reportes — incidents.incidents.idempotency_key
-- ============================================================================
-- Propósito: evitar incidentes DUPLICADOS cuando el cliente móvil reintenta el
-- envío del MISMO reporte con red lenta (p. ej. POST /image/analyze hace timeout
-- en el cliente pero el servidor sí lo recibió y encoló). El cliente genera un
-- UUID estable por reporte y lo reenvía en cada reintento; el image-service lo
-- usa para devolver el incidente ya creado en vez de crear otro.
--
-- RESTRICCIÓN DE LA PARTICIÓN (migración 021)
-- -------------------------------------------
-- incidents.incidents está particionada por RANGE(created_at). PostgreSQL exige
-- que todo índice UNIQUE incluya la columna de partición (created_at), pero cada
-- reintento del mismo reporte tiene un created_at distinto → un UNIQUE NO
-- deduplicaría. Por eso:
--   • el índice es NO único (solo acelera el lookup), y
--   • la unicidad lógica la garantiza pg_advisory_xact_lock en image.service.js,
--     que serializa los INSERT concurrentes con la misma (reportado_por, clave).
--
-- Idempotente (IF NOT EXISTS): seguro de re-ejecutar.
-- ============================================================================

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS idempotency_key UUID;

COMMENT ON COLUMN incidents.incidents.idempotency_key IS
    'Clave de idempotencia generada por el cliente (UUID v4), estable entre '
    'reintentos del mismo reporte. El image-service la usa para no crear '
    'incidentes duplicados ante reenvíos por red lenta. NULL en reportes de '
    'clientes que no la envían (compat hacia atrás).';

-- Índice parcial para el lookup del servicio:
--   WHERE reportado_por = $1 AND idempotency_key = $2
-- Se propaga automáticamente a todas las particiones (definido en el padre).
CREATE INDEX IF NOT EXISTS idx_incidents_idempotency
    ON incidents.incidents (reportado_por, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
