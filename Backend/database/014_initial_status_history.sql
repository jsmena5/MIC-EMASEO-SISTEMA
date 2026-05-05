-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 014
-- Registra el estado inicial de cada incidente en status_history al momento
-- de su creación.
--
-- Problema que resuelve:
--   fn_log_status_change (trigger 011) se activa en UPDATE, no en INSERT.
--   La transición NULL → PROCESANDO (o PENDIENTE) se perdía; los incidentes
--   "aparecían" en auditoría sin historial previo.
--
-- Cambio de esquema:
--   estado_anterior era NOT NULL pero no existe estado previo en el INSERT
--   inicial. Se elimina esa restricción para permitir NULL en la primera fila
--   de auditoría. El CHECK chk_status_change sigue siendo válido: en
--   PostgreSQL, NULL <> valor evalúa a NULL, que no viola la restricción.
-- ============================================================================

BEGIN;

-- Permite NULL en estado_anterior para representar "sin estado previo"
ALTER TABLE incidents.status_history
    ALTER COLUMN estado_anterior DROP NOT NULL;

-- ============================================================================
-- FUNCIÓN DEL TRIGGER
-- Inserta la primera fila de auditoría justo después de crear el incidente.
-- cambiado_por usa reportado_por (NOT NULL en incidents) como autor del evento.
-- ============================================================================
CREATE OR REPLACE FUNCTION incidents.fn_log_initial_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO incidents.status_history (
        incident_id,
        estado_anterior,
        estado_nuevo,
        cambiado_por,
        observaciones
    ) VALUES (
        NEW.id,
        NULL,
        NEW.estado,
        NEW.reportado_por,
        'Estado inicial al crear incidente'
    );
    RETURN NEW;
END;
$$;

-- ============================================================================
-- TRIGGER
-- Prefijo trg_05 para ejecutarse antes que futuros triggers de orden superior.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_05_log_initial_status ON incidents.incidents;

CREATE TRIGGER trg_05_log_initial_status
    AFTER INSERT ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_log_initial_status();

COMMIT;
