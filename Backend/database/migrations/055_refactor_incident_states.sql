-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 055
-- Estandarización del ciclo de vida de incidencias
--
-- Cambios:
--   EN_REVISION → datos migran a PENDIENTE (valor queda en el enum sin uso)
--   REVISADO    → renombrado a VALIDO      (ALTER TYPE RENAME VALUE)
--   RECHAZADA   → renombrado a RECHAZADO   (ALTER TYPE RENAME VALUE)
--
-- ALTER TYPE ... RENAME VALUE (PostgreSQL 10+) opera solo sobre el catálogo,
-- no toca datos ni triggers. Mucho más seguro que DROP TYPE + recrear.
--
-- Resultado funcional: 7 estados activos
--   PROCESANDO, PENDIENTE, VALIDO, EN_ATENCION, RESUELTA, RECHAZADO,
--   DESCARTADO, FALLIDO
-- (EN_REVISION permanece como valor legacy inactivo en el catálogo)
-- ============================================================================

BEGIN;

-- ── 1. Migrar datos EN_REVISION → PENDIENTE ──────────────────────────────────
UPDATE incidents.incidents
SET estado = 'PENDIENTE'
WHERE estado = 'EN_REVISION';

-- ── 2. Renombrar valores del ENUM (operación sobre catálogo, no sobre datos) ──
ALTER TYPE incidents.incident_status RENAME VALUE 'REVISADO'  TO 'VALIDO';
ALTER TYPE incidents.incident_status RENAME VALUE 'RECHAZADA' TO 'RECHAZADO';

-- ── 3. Actualizar fn_notify_citizen con los nuevos nombres de estado ──────────
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
            -- PROCESANDO, VALIDO, FALLIDO, EN_REVISION (legacy): sin notificación
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
