-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 011
-- Auditoría automática de cambios de estado en incidentes.
--
-- Problema que resuelve:
--   La tabla incidents.status_history existía sin que ningún servicio
--   insertara filas. Además, las transiciones automáticas del ML no tienen
--   un UUID de usuario humano para cumplir la FK cambiado_por NOT NULL.
--
-- Solución:
--   1. Usuario de sistema (UUID fijo) para transiciones automáticas (ML, jobs).
--   2. Trigger AFTER UPDATE que escribe status_history en cada cambio de estado.
--      Si el servicio establece app.current_user_id en la sesión, se usa ese
--      usuario; de lo contrario se cae al usuario de sistema.
--
-- Compatibilidad: PostgreSQL 15+ con pgcrypto habilitado (ya está en schema 01).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. USUARIO DE SISTEMA
-- UUID fijo "todo-ceros-0001" — nunca cambia, referenciable en código.
-- La contraseña es aleatoria e irrecuperable (no se puede hacer login).
-- ON CONFLICT DO NOTHING permite re-ejecutar esta migración sin error.
-- ============================================================================
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

-- ============================================================================
-- 2. FUNCIÓN DEL TRIGGER
-- Lee app.current_user_id de la sesión de PostgreSQL (SET LOCAL antes del
-- UPDATE en el servicio Node.js).  Si no está definida o está vacía, usa el
-- usuario de sistema para cubrir transiciones automáticas del ML.
-- ============================================================================
CREATE OR REPLACE FUNCTION incidents.fn_log_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        INSERT INTO incidents.status_history
            (incident_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES (
            NEW.id,
            OLD.estado,
            NEW.estado,
            COALESCE(
                NULLIF(current_setting('app.current_user_id', true), '')::uuid,
                '00000000-0000-0000-0000-000000000001'
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. TRIGGER
-- Se activa AFTER UPDATE para que NEW ya tenga el estado guardado.
-- FOR EACH ROW garantiza una entrada por incidente modificado.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_log_status_change ON incidents.incidents;

CREATE TRIGGER trg_log_status_change
    AFTER UPDATE OF estado ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_log_status_change();

COMMIT;
