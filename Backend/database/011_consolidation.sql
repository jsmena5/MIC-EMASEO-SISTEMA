-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 011
-- Consolidación: cierra las brechas entre el schema diseñado y el código
-- implementado. Idempotente — seguro de ejecutar más de una vez.
--
-- Cambios:
--   1. Usuario SISTEMA para atribuir transiciones automáticas del pipeline ML
--   2. Columna nota_fallo en incidents.incidents
--   3. Trigger fn_log_status_change → auto-escribe status_history en cada cambio
--      de estado; también setea resuelto_at cuando el estado llega a RESUELTA
--   4. Trigger fn_notify_citizen → inserta en notifications.notifications cuando
--      el estado cambia a PENDIENTE, EN_ATENCION, RESUELTA o RECHAZADA
-- ============================================================================

-- ── 1. Usuario SISTEMA ────────────────────────────────────────────────────────
-- UUID fijo para que el código Node.js pueda referenciarlo sin consulta previa.
-- La contraseña es un hash aleatorio irrepetible (nadie puede autenticarse como SISTEMA).

INSERT INTO auth.users (id, email, username, password_hash, rol, estado, is_verified)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'sistema@emaseo.gob.ec',
    'SISTEMA',
    crypt(gen_random_uuid()::text, gen_salt('bf')),
    'ADMIN',
    'ACTIVO',
    TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Columna nota_fallo ─────────────────────────────────────────────────────
-- Distingue "ML no detectó residuos" (foto incorrecta del ciudadano)
-- de "error técnico" (ML caído, S3 falla, timeout). Clave para métricas.

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS nota_fallo TEXT;

COMMENT ON COLUMN incidents.incidents.nota_fallo IS
    'Razón de fallo: "ML no detectó residuos" o mensaje de error técnico. NULL si el análisis tuvo éxito.';

-- ── 3. Trigger: auto-log de cambios de estado → status_history ───────────────
--
-- Atribución del actor:
--   • Supervisor / Operario: setean `SET LOCAL app.current_user_id = '<uuid>'`
--     antes de la transacción que actualiza el estado. El trigger lee ese valor.
--   • Pipeline ML (background, sin usuario): no setea la variable → el trigger
--     cae en el COALESCE y usa el usuario SISTEMA.
--
-- BEFORE (no AFTER): necesario para poder modificar NEW.resuelto_at
-- en la misma fila antes de que el UPDATE se confirme.

CREATE OR REPLACE FUNCTION incidents.fn_log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID;
    v_raw   TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN

        -- Leer actor de la variable de sesión; si no está seteada → SISTEMA
        v_raw   := current_setting('app.current_user_id', true);
        v_actor := NULLIF(v_raw, '')::uuid;
        IF v_actor IS NULL THEN
            v_actor := '00000000-0000-0000-0000-000000000001';
        END IF;

        INSERT INTO incidents.status_history
            (incident_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES
            (NEW.id, OLD.estado, NEW.estado, v_actor);

        -- Marcar timestamp de resolución cuando el incidente se cierra
        IF NEW.estado = 'RESUELTA' THEN
            NEW.resuelto_at := NOW();
        END IF;

    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_log_status_change IS
    'Registra cada transición de estado en status_history y setea resuelto_at al resolver.';

DROP TRIGGER IF EXISTS trg_log_status_change ON incidents.incidents;
CREATE TRIGGER trg_log_status_change
    BEFORE UPDATE OF estado ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_log_status_change();

-- ── 4. Trigger: notificación al ciudadano en cambios de estado relevantes ─────
--
-- Solo genera notificación en los estados visibles al ciudadano:
--   PENDIENTE   → su reporte fue aceptado por el sistema
--   EN_ATENCION → un equipo ya está en camino
--   RESUELTA    → el punto fue limpiado
--   RECHAZADA   → el reporte no pudo procesarse
--
-- PROCESANDO y FALLIDO no generan notificación (son estados internos).
-- AFTER trigger: lee NEW.prioridad ya confirmada después del UPDATE.

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
            ELSE
                RETURN NEW; -- PROCESANDO, FALLIDO: sin notificación al ciudadano
        END CASE;

        INSERT INTO notifications.notifications
            (usuario_id, incident_id, titulo, mensaje, canal)
        VALUES
            (NEW.reportado_por, NEW.id, v_titulo, v_mensaje, 'PUSH');
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_notify_citizen IS
    'Inserta una notificación PUSH al ciudadano en cada transición de estado visible.';

DROP TRIGGER IF EXISTS trg_notify_citizen ON incidents.incidents;
CREATE TRIGGER trg_notify_citizen
    AFTER UPDATE OF estado ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_notify_citizen();

-- ============================================================================
-- VERIFICACIÓN (ejecutar manualmente después de aplicar)
-- ============================================================================
-- SELECT id, email, username, rol FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='incidents' AND table_name='incidents' AND column_name='nota_fallo';
-- SELECT trigger_name, event_manipulation FROM information_schema.triggers
--   WHERE event_object_schema='incidents' AND event_object_table='incidents';
-- ============================================================================
