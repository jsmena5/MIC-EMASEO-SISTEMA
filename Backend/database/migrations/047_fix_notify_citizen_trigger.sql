-- Migración 047: corrige fn_notify_citizen() — restaura incident_created_at
--
-- La migración 032 reemplazó fn_notify_citizen() con una versión que omite
-- incident_created_at en el INSERT. Esto viola la restricción
-- chk_notif_incident_coherence (que exige que incident_id e incident_created_at
-- sean ambos NULL o ambos NOT NULL), lo que provoca que TODA la transacción
-- se revierta cuando un incidente cambia a PENDIENTE, DESCARTADO, RESUELTA,
-- RECHAZADA o EN_ATENCION — impidiendo tanto el cambio de estado como la
-- creación de notificaciones.
--
-- Esta migración restaura el comportamiento correcto de la v2 (migración 021).

CREATE OR REPLACE FUNCTION incidents.fn_notify_citizen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        CASE NEW.estado
            WHEN 'PENDIENTE' THEN
                v_titulo  := 'Reporte aceptado';
                v_mensaje := 'Tu reporte fue validado. Prioridad asignada: '
                             || COALESCE(NEW.prioridad::text, 'por determinar') || '.';
            WHEN 'EN_ATENCION' THEN
                v_titulo  := 'Reporte en atención';
                v_mensaje := 'Un equipo de operarios está atendiendo el punto de acumulación de residuos que reportaste.';
            WHEN 'RESUELTA' THEN
                v_titulo  := '¡Reporte resuelto!';
                v_mensaje := 'El punto de acumulación de residuos fue limpiado. ¡Gracias por contribuir con tu ciudad!';
            WHEN 'RECHAZADA' THEN
                v_titulo  := 'Reporte rechazado';
                v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido en esta ocasión. Puedes enviar uno nuevo con más detalle.';
            WHEN 'DESCARTADO' THEN
                v_titulo  := 'Imagen sin residuos detectados';
                v_mensaje := 'El análisis automático no detectó acumulación de residuos en tu imagen. '
                             || 'Si crees que es un error, envía un nuevo reporte con una foto más clara y de mayor acercamiento.';
            -- EN_REVISION, PROCESANDO, FALLIDO: sin notificación al ciudadano.
            ELSE
                RETURN NEW;
        END CASE;

        INSERT INTO notifications.notifications
            (usuario_id, incident_id, incident_created_at, titulo, mensaje, canal)
        VALUES
            (NEW.reportado_por, NEW.id, NEW.created_at, v_titulo, v_mensaje, 'PUSH');
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_notify_citizen IS
    'Inserta una notificación PUSH al ciudadano en cada transición de estado visible. '
    'v3: restaura incident_created_at en el INSERT (requerido por chk_notif_incident_coherence). '
    'EN_REVISION no notifica al ciudadano; lo hará cuando el supervisor resuelva.';
