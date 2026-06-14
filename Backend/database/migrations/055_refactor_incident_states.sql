-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 055
-- Estandarización del ciclo de vida de incidencias
--
-- Cambios:
--   EN_REVISION → PENDIENTE   (merge: mismo significado operativo)
--   REVISADO    → VALIDO      (rename: semántica clara)
--   RECHAZADA   → RECHAZADO   (rename: coherencia gramatical)
--
-- Resultado: 7 estados (PROCESANDO, PENDIENTE, VALIDO, EN_ATENCION,
--            RESUELTA, RECHAZADO, DESCARTADO, FALLIDO)
--
-- NOTA: ADD VALUE no puede ejecutarse en bloque de transacción explícito.
-- Los ADD VALUE van fuera del BEGIN..COMMIT.
-- NOTA 2: Los triggers que dependen del tipo de columna deben dropearse
-- antes de alterar el tipo y recrearse al final.
-- ============================================================================

-- ── 1. Añadir nuevos valores al ENUM (fuera de transacción) ──────────────────

ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'VALIDO';
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'RECHAZADO';

-- ── 2. Migrar datos y reconstruir el tipo ────────────────────────────────────

BEGIN;

-- 2a. Migrar registros a los nuevos valores
UPDATE incidents.incidents SET estado = 'PENDIENTE' WHERE estado = 'EN_REVISION';
UPDATE incidents.incidents SET estado = 'VALIDO'    WHERE estado = 'REVISADO';
UPDATE incidents.incidents SET estado = 'RECHAZADO' WHERE estado = 'RECHAZADA';

-- 2b. Dropear triggers que dependen del tipo de la columna estado
DROP TRIGGER IF EXISTS trg_10_log_status_change ON incidents.incidents;
DROP TRIGGER IF EXISTS trg_20_notify_citizen    ON incidents.incidents;
DROP TRIGGER IF EXISTS trg_05_log_initial_status ON incidents.incidents;

-- 2c. Convertir la columna a TEXT para reemplazar el tipo ENUM
ALTER TABLE incidents.incidents ALTER COLUMN estado TYPE TEXT;

-- 2d. Eliminar el tipo antiguo y crear uno limpio
DROP TYPE incidents.incident_status;

CREATE TYPE incidents.incident_status AS ENUM (
    'PROCESANDO',
    'PENDIENTE',
    'VALIDO',
    'EN_ATENCION',
    'RESUELTA',
    'RECHAZADO',
    'DESCARTADO',
    'FALLIDO'
);

-- 2e. Restaurar el tipo en la columna
ALTER TABLE incidents.incidents
    ALTER COLUMN estado TYPE incidents.incident_status
    USING estado::incidents.incident_status;

-- 2f. Actualizar fn_notify_citizen para reflejar nuevos estados
CREATE OR REPLACE FUNCTION incidents.fn_notify_citizen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    CASE NEW.estado
        WHEN 'PENDIENTE' THEN
            v_titulo  := 'Reporte recibido';
            v_mensaje := 'Tu reporte fue validado y está en espera de atención.';
        WHEN 'EN_ATENCION' THEN
            v_titulo  := 'Reporte en atención';
            v_mensaje := 'Un equipo operativo está atendiendo tu reporte.';
        WHEN 'RESUELTA' THEN
            v_titulo  := 'Reporte resuelto';
            v_mensaje := 'El equipo operativo resolvió el problema reportado.';
        WHEN 'RECHAZADO' THEN
            v_titulo  := 'Reporte rechazado';
            v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido.';
        WHEN 'DESCARTADO' THEN
            v_titulo  := 'Reporte descartado';
            v_mensaje := 'La imagen enviada no mostró acumulación de residuos detectable.';
        ELSE
            -- PROCESANDO, VALIDO, FALLIDO: sin notificación al ciudadano
            RETURN NEW;
    END CASE;

    INSERT INTO notifications.notifications
        (usuario_id, incident_id, incident_created_at, titulo, mensaje, canal)
    VALUES
        (NEW.reportado_por, NEW.id, NEW.created_at, v_titulo, v_mensaje, 'PUSH');

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[fn_notify_citizen] Error al insertar notificación: %', SQLERRM;
        RETURN NEW;
END;
$$;

-- 2g. Recrear triggers que se dropearon en 2b
CREATE TRIGGER trg_05_log_initial_status
    AFTER INSERT ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_log_initial_status();

CREATE TRIGGER trg_10_log_status_change
    BEFORE UPDATE OF estado ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_log_status_change();

CREATE TRIGGER trg_20_notify_citizen
    AFTER UPDATE OF estado ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_notify_citizen();

COMMIT;
