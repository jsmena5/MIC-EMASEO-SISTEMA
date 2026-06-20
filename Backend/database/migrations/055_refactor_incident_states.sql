-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 055
-- Estandarización del ciclo de vida de incidencias
--
-- Estado actual del ENUM en producción (tras intentos previos parciales):
--   PENDIENTE, EN_ATENCION, RESUELTA, RECHAZADA, PROCESANDO, FALLIDO,
--   EN_REVISION, DESCARTADO, REVISADO, VALIDO, RECHAZADO
--
-- VALIDO y RECHAZADO ya existen (fueron añadidos por ADD VALUE en intentos
-- anteriores que no completaron). Solo necesitamos migrar los datos y
-- actualizar la función de notificación.
--
-- Los valores legacy (REVISADO, RECHAZADA, EN_REVISION) quedan en el catálogo
-- como inactivos. No causan problemas en runtime.
-- ============================================================================

BEGIN;

-- ── 1. Migrar datos a los nuevos valores ─────────────────────────────────────
UPDATE incidents.incidents SET estado = 'PENDIENTE'  WHERE estado = 'EN_REVISION';
UPDATE incidents.incidents SET estado = 'VALIDO'     WHERE estado = 'REVISADO';
UPDATE incidents.incidents SET estado = 'RECHAZADO'  WHERE estado = 'RECHAZADA';

-- ── 2. Actualizar fn_notify_citizen ──────────────────────────────────────────
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
            -- PROCESANDO, VALIDO, FALLIDO y valores legacy: sin notificación
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

COMMIT;
