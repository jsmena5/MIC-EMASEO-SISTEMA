-- Migración 063: trazabilidad de los gates ML en ai.analysis_results
--
-- CONTEXTO
-- El pipeline ML calcula dos señales clave para decidir si una imagen es basura:
--   • garbage_prob  → salida del gate semántico CLIP (semantic_gate.py)
--   • garbage_score → heurística de textura/color/posición (ml_utils.compute_garbage_score)
-- y un top_label CLIP que indica con qué prompt emparejó la imagen.
--
-- Estos valores son los que determinan si un incidente se DESCARTA, va a
-- EN_REVISIÓN o pasa a PENDIENTE. Hasta ahora SOLO existían en los logs del
-- ml-worker (efímeros) y, parcialmente, en incidents.nota_fallo como texto.
-- Para los casos PENDIENTE (camino positivo, finalizeIncident) NO se guardaba
-- nada de esto.
--
-- PROBLEMA QUE RESUELVE
-- Cuando un falso positivo llega como PENDIENTE (ej. F564E34A: una botella de
-- gaseosa clasificada como basura MEDIO 1.30 m³), no hay forma de consultar por
-- SQL qué garbage_prob produjo CLIP. Calibrar el umbral SEMANTIC_REJECT_THRESHOLD
-- a ciegas es adivinar. Persistir estas columnas convierte cada falso positivo en
-- evidencia consultable para afinar prompts y umbrales.
--
-- DECISIÓN
-- Añadir 3 columnas nullable (datos históricos quedan en NULL; no rompe nada):
--   garbage_prob        NUMERIC(4,3)  — misma precisión que confianza (0.000–1.000)
--   garbage_score       NUMERIC(4,3)  — heurística de textura (0.000–1.000)
--   semantic_top_label  TEXT          — prompt CLIP ganador (auditoría/diagnóstico)
--
-- Idempotente: ADD COLUMN IF NOT EXISTS es seguro de re-ejecutar.
-- Ejecutar como superusuario (postgres) o dueño de la tabla.

ALTER TABLE ai.analysis_results
    ADD COLUMN IF NOT EXISTS garbage_prob       NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS garbage_score      NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS semantic_top_label TEXT;

-- Rango coherente con confianza: ambas probabilidades viven en [0, 1].
-- NOT VALID evita el escaneo completo de la tabla al crear el constraint;
-- los datos nuevos sí se validan. (Se puede VALIDATE CONSTRAINT después en
-- una ventana de baja carga si se desea.)
ALTER TABLE ai.analysis_results
    ADD CONSTRAINT chk_garbage_prob_range
        CHECK (garbage_prob IS NULL OR (garbage_prob >= 0 AND garbage_prob <= 1)) NOT VALID;

ALTER TABLE ai.analysis_results
    ADD CONSTRAINT chk_garbage_score_range
        CHECK (garbage_score IS NULL OR (garbage_score >= 0 AND garbage_score <= 1)) NOT VALID;

COMMENT ON COLUMN ai.analysis_results.garbage_prob       IS 'Salida del gate semántico CLIP: P(basura) en [0,1]. NULL en registros previos a la migración 063.';
COMMENT ON COLUMN ai.analysis_results.garbage_score      IS 'Heurística de textura/color/posición (compute_garbage_score) en [0,1].';
COMMENT ON COLUMN ai.analysis_results.semantic_top_label IS 'Prompt CLIP con mayor probabilidad para la imagen (diagnóstico de falsos positivos).';
