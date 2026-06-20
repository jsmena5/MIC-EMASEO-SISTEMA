-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 033
-- Correcciones supervisoras de decisiones IA en ai.analysis_results
--
-- Problema previo:
--   La migración 032 introdujo el flujo de revisión humana (EN_REVISION,
--   DESCARTADO) y el feedback binario en ai.analysis_feedback, pero no
--   proporcionaba un lugar estructurado para que el supervisor registrara:
--     A. Si la IA fue correcta o incorrecta (veredicto firmado)
--     B. La severidad real (nivel de acumulación) cuando la IA se equivocó
--     C. El tipo de residuo real cuando la IA se equivocó
--     D. Una nota libre de auditoría
--     E. Quién hizo la corrección y cuándo (trazabilidad)
--
-- Diseño:
--   Se extiende ai.analysis_results (relación 1:1 con el incidente) en lugar
--   de crear una tabla nueva para mantener la consulta de detalle simple.
--   Los datos ML originales NO SE MODIFICAN — las columnas *_supervisor
--   son siempre aditivas: el supervisor anota lo que debería haber sido,
--   preservando el resultado original para auditoría del modelo.
--
-- Columnas nuevas en ai.analysis_results:
--   nivel_acumulacion_supervisor — nivel correcto según el supervisor
--   tipo_residuo_supervisor      — tipo correcto según el supervisor
--   ia_fue_correcta              — veredicto firmado: TRUE/FALSE
--   nota_supervision             — texto libre de auditoría
--   supervisado_por              — UUID del supervisor que corrigió
--   supervisado_at               — timestamp de la corrección
-- ============================================================================

-- ── Columnas de corrección supervisora ───────────────────────────────────────

ALTER TABLE ai.analysis_results
    ADD COLUMN IF NOT EXISTS nivel_acumulacion_supervisor  ai.accumulation_level,
    ADD COLUMN IF NOT EXISTS tipo_residuo_supervisor       ai.waste_type,
    ADD COLUMN IF NOT EXISTS ia_fue_correcta               BOOLEAN,
    ADD COLUMN IF NOT EXISTS nota_supervision              TEXT,
    ADD COLUMN IF NOT EXISTS supervisado_por               UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS supervisado_at                TIMESTAMPTZ;

COMMENT ON COLUMN ai.analysis_results.nivel_acumulacion_supervisor IS
    'Nivel de acumulación real según el supervisor. NULL = no corregido. '
    'El valor original ML (nivel_acumulacion) NO se modifica — este campo es aditivo.';

COMMENT ON COLUMN ai.analysis_results.tipo_residuo_supervisor IS
    'Tipo de residuo real según el supervisor. NULL = no corregido. '
    'El valor original ML (tipo_residuo) NO se modifica — este campo es aditivo.';

COMMENT ON COLUMN ai.analysis_results.ia_fue_correcta IS
    'Veredicto firmado del supervisor: TRUE = IA correcta, FALSE = IA incorrecta. '
    'NULL = no revisado todavía. Diferente de ai.analysis_feedback donde múltiples '
    'usuarios pueden opinar; aquí es la decisión oficial del supervisor.';

COMMENT ON COLUMN ai.analysis_results.nota_supervision IS
    'Nota libre de auditoría del supervisor. Ejemplo: "Imagen muestra escombros "
    "de construcción, no domésticos. Nivel real es ALTO no MEDIO."';

COMMENT ON COLUMN ai.analysis_results.supervisado_por IS
    'UUID del supervisor/admin que realizó la corrección. FK a auth.users.';

COMMENT ON COLUMN ai.analysis_results.supervisado_at IS
    'Timestamp de la última corrección supervisora. Permite ordenar las revisiones.';

-- ── Índices para consultas operativas ────────────────────────────────────────

-- Buscar todos los incidentes ya revisados por un supervisor específico
CREATE INDEX IF NOT EXISTS idx_ai_supervisado
    ON ai.analysis_results (supervisado_por, supervisado_at DESC)
    WHERE supervisado_por IS NOT NULL;

-- Cola de auditoría: incidentes donde la IA fue marcada como incorrecta
-- Hot path para el dashboard de calidad del modelo (drift detection)
CREATE INDEX IF NOT EXISTS idx_ai_ia_incorrecta
    ON ai.analysis_results (supervisado_at DESC)
    WHERE ia_fue_correcta = FALSE;

-- Incidentes aún no revisados que tienen resultado ML (pendientes de supervisión)
CREATE INDEX IF NOT EXISTS idx_ai_pendiente_revision
    ON ai.analysis_results (created_at DESC)
    WHERE supervisado_por IS NULL;

-- ============================================================================
-- VERIFICACIÓN (ejecutar manualmente después de aplicar)
-- ============================================================================
-- -- Nuevas columnas:
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'ai' AND table_name = 'analysis_results'
--     AND column_name IN (
--       'nivel_acumulacion_supervisor', 'tipo_residuo_supervisor',
--       'ia_fue_correcta', 'nota_supervision',
--       'supervisado_por', 'supervisado_at'
--     );
--
-- -- Índices nuevos:
-- SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'analysis_results' AND schemaname = 'ai'
--     AND indexname LIKE 'idx_ai_%';
-- ============================================================================
