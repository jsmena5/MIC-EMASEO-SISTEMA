-- Migración 049: Agrega el estado REVISADO al ciclo de vida de los incidentes.
--
-- Contexto: en el alcance actual del proyecto el supervisor solo valida e
-- clasifica (no asigna operarios). Una vez que el supervisor clasifica la
-- decisión de la IA, el incidente pasa a REVISADO en lugar de EN_ATENCION.
-- REVISADO es terminal dentro del flujo del supervisor; queda disponible
-- para integraciones futuras de asignación operativa.
--
-- Transición habilitada en el backend (supervisor.controller.js):
--   PENDIENTE → REVISADO
--
-- Aplica en producción (desde el VPS o con psql apuntando a Supabase):
--   PGPASSWORD=$DB_PASSWORD psql "host=<supabase_host> port=5432 dbname=postgres \
--     user=postgres sslmode=require" -f Backend/database/049_add_estado_revisado.sql

-- 1. Añadir el valor al enum (IF NOT EXISTS evita error si ya existe)
-- Nota: el tipo se llama incident_status en el schema incidents
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'REVISADO';

-- 2. Actualizar fn_notify_citizen para que REVISADO no genere notificación al ciudadano
--    (el ciudadano no necesita saber que el supervisor clasificó; solo le importa la
--    resolución o el rechazo final).
CREATE OR REPLACE FUNCTION incidents.fn_notify_citizen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    -- Solo notificar en transiciones relevantes para el ciudadano
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
        WHEN 'RECHAZADA' THEN
            v_titulo  := 'Reporte rechazado';
            v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido.';
        WHEN 'DESCARTADO' THEN
            v_titulo  := 'Reporte descartado';
            v_mensaje := 'La imagen enviada no mostró acumulación de residuos detectable.';
        ELSE
            -- PROCESANDO, EN_REVISION, REVISADO, FALLIDO: sin notificación al ciudadano
            RETURN NEW;
    END CASE;

    INSERT INTO notifications.notifications
        (usuario_id, incident_id, incident_created_at, titulo, mensaje, canal)
    VALUES
        (NEW.reportado_por, NEW.id, NEW.created_at, v_titulo, v_mensaje, 'PUSH');

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- El trigger no debe bloquear la transición de estado
        RAISE WARNING '[fn_notify_citizen] Error al insertar notificación: %', SQLERRM;
        RETURN NEW;
END;
$$;
