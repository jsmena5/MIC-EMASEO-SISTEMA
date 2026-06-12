-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 041 — Motivo estructurado de rechazo
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Problema:
--   El campo `observaciones` (TEXT libre) en status_history no escala: no permite
--   medir cuánto se equivoca cada gate del pipeline IA ni calibrar umbrales con
--   datos reales. Con 1k-5k rechazos, analizar texto libre es inviable.
--
-- Solución:
--   Nuevo ENUM incidents.rejection_reason + columna motivo_rechazo en
--   status_history. Los valores mapean 1:1 a causas reales del pipeline:
--
--     NO_ES_BASURA      → falso positivo semántico (CLIP / RT-DETR se equivocó)
--     MUY_LEJOS_PEQUENO → gate de cobertura mínima (MIN_COVERAGE_UNION)
--     IMAGEN_BORROSA    → gate de nitidez (BLUR_VARIANCE_MIN)
--     DUPLICADO         → reporte duplicado de otro ciudadano
--     OTRO              → requiere leer observaciones; captura edge cases
--
--   Las observaciones (texto) permanecen para casos OTRO o notas adicionales.
--   Esto convierte cada rechazo en una etiqueta categórica usable para:
--     1. Calibrar empíricamente SEMANTIC_REJECT/REVIEW_THRESHOLD con datos reales.
--     2. Medir drift del pipeline por categoría a lo largo del tiempo.
--     3. Informar al ciudadano con un mensaje claro (no dejarle "a la deriva").
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Crear ENUM (si ya existe, no falla)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'rejection_reason' AND n.nspname = 'incidents'
  ) THEN
    CREATE TYPE incidents.rejection_reason AS ENUM (
      'NO_ES_BASURA',
      'MUY_LEJOS_PEQUENO',
      'IMAGEN_BORROSA',
      'DUPLICADO',
      'OTRO'
    );
  END IF;
END $$;

-- 2. Añadir columna a status_history
ALTER TABLE incidents.status_history
  ADD COLUMN IF NOT EXISTS motivo_rechazo incidents.rejection_reason;

-- 3. Índice para análisis de distribución por motivo
CREATE INDEX IF NOT EXISTS idx_status_motivo_rechazo
  ON incidents.status_history (motivo_rechazo)
  WHERE motivo_rechazo IS NOT NULL;

COMMENT ON COLUMN incidents.status_history.motivo_rechazo IS
  'Categoría estructurada del rechazo. Solo se rellena cuando estado_nuevo = RECHAZADA. '
  'Complementa observaciones (texto libre) para análisis cuantitativos del pipeline IA.';
