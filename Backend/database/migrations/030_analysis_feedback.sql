-- ============================================================================
-- Migración 030: tabla de feedback sobre análisis de IA
-- ============================================================================
-- Propósito: permite que operarios y supervisores confirmen si la detección
-- de residuos fue correcta. Base para el pipeline de detección de drift y
-- para reentrenamiento supervisado del modelo (M-09).
--
-- Diseño:
--   • Una fila de feedback por usuario por análisis (UNIQUE analysis_result_id, reportado_por).
--     Un usuario puede actualizar su feedback; otro usuario puede dar el suyo independientemente.
--   • No hay FK en cascade a incidents — el análisis puede consultarse
--     aunque el incidente haya sido archivado.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai.analysis_feedback (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_result_id UUID         NOT NULL REFERENCES ai.analysis_results(id) ON DELETE CASCADE,
    es_correcta        BOOLEAN      NOT NULL,
    comentario         TEXT,
    reportado_por      UUID         NOT NULL REFERENCES auth.users(id),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_feedback_per_user UNIQUE (analysis_result_id, reportado_por)
);

COMMENT ON TABLE  ai.analysis_feedback IS
    'Feedback de operarios/supervisores sobre la precisión de los análisis IA. '
    'Base para detección de drift y reentrenamiento del modelo.';
COMMENT ON COLUMN ai.analysis_feedback.es_correcta IS
    'TRUE = detección correcta; FALSE = falso positivo o clasificación errónea.';
COMMENT ON COLUMN ai.analysis_feedback.comentario IS
    'Texto libre: tipo real de residuo observado, descripción del error, etc.';

-- Trigger para mantener updated_at al día en UPDATEs
CREATE OR REPLACE FUNCTION ai.fn_touch_feedback_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_feedback_updated_at
    BEFORE UPDATE ON ai.analysis_feedback
    FOR EACH ROW EXECUTE FUNCTION ai.fn_touch_feedback_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_feedback_analysis
    ON ai.analysis_feedback (analysis_result_id);

CREATE INDEX IF NOT EXISTS idx_feedback_usuario
    ON ai.analysis_feedback (reportado_por);

CREATE INDEX IF NOT EXISTS idx_feedback_incorrectos
    ON ai.analysis_feedback (es_correcta)
    WHERE es_correcta = FALSE;
