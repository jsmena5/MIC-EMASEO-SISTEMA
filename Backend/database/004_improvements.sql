-- ============================================================================
-- MIC-EMASEO — Mejoras Post-Diagnóstico
-- Ejecutar después de 001_schema.sql
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 1: CRÍTICO — Eliminar índice duplicado
-- Email tiene UNIQUE constraint que ya crea índice implícito.
-- Este índice extra duplica escrituras en cada INSERT/UPDATE.
-- ─────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS auth.idx_users_email;

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 2: ALTO — Índice compuesto para "mis incidencias"
-- Cubre la consulta más frecuente del ciudadano:
--   WHERE reportado_por = $1 AND estado = $2 ORDER BY created_at DESC
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_incidents_owner_estado
    ON incidents.incidents (reportado_por, estado, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 3: ALTO — Índice GIN para búsquedas en JSONB de detecciones
-- Necesario cuando se filtre por tipo de objeto detectado por la IA:
--   WHERE detecciones @> '[{"class": "PLASTICO"}]'
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_ai_detecciones_gin
    ON ai.analysis_results USING GIN (detecciones);

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 4: MEDIO — Índice para notificaciones ordenadas por fecha
-- Cubre: WHERE usuario_id = $1 ORDER BY created_at DESC LIMIT 20
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_notif_usuario_fecha
    ON notifications.notifications (usuario_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 5: MEDIO — Prevenir asignaciones duplicadas activas
-- Un operario no puede tener la misma incidencia asignada dos veces
-- mientras completada = FALSE.
-- ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX uq_assignment_activa
    ON incidents.assignments (incident_id, operario_id)
    WHERE completada = FALSE;
-- NOTA: Índice parcial — permite reasignaciones históricas (completada=TRUE)

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 6: BAJO — Corregir trigger para zonas superpuestas
-- Agrega ORDER BY área ascendente: asigna la zona más pequeña
-- (más específica) cuando hay solapamiento de polígonos.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION incidents.fn_assign_zone()
RETURNS TRIGGER AS $$
BEGIN
    NEW.zona_id := (
        SELECT id FROM operations.zones
        WHERE activa = TRUE
          AND ST_Covers(geom, NEW.ubicacion)   -- más robusto en bordes
        ORDER BY ST_Area(geom) ASC             -- zona más específica primero
        LIMIT 1
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────
-- PRIORIDAD 7: BAJO — Constraint para reanálisis IA (opcional)
-- Si decides permitir múltiples análisis por incidencia en el futuro,
-- cambia la constraint UNIQUE por un índice compuesto con versión.
-- SOLO ejecutar si decides cambiar la relación 1:1 a 1:N.
-- ─────────────────────────────────────────────────────────────────
-- ALTER TABLE ai.analysis_results DROP CONSTRAINT ai_analysis_results_incident_id_key;
-- ALTER TABLE ai.analysis_results ADD COLUMN es_activo BOOLEAN NOT NULL DEFAULT TRUE;
-- CREATE UNIQUE INDEX uq_ai_activo ON ai.analysis_results (incident_id) WHERE es_activo = TRUE;
