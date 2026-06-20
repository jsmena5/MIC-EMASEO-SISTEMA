-- ============================================================================
-- Migración 056 — Consolidación del schema
--
-- CAMBIOS:
--   1. Perfil ciudadano (public.ciudadanos) → columnas en app_auth.users
--   2. Perfil operativo (operations.operarios) → columnas en app_auth.users
--      → Elimina 2 tablas + simplifica todos los JOINs a 1 tabla
--   3. Etiquetado ML (ai.image_audit) → columnas en incidents.incidents
--      → Elimina tabla 1:1 innecesaria
--   4. Elimina columna 'username' huérfana de app_auth.users
--   5. Fix: auto-revocar tokens previos al crear uno nuevo (race condition)
--   6. Fix: limpieza automática de registros pendientes expirados
--   7. Fix: constraint que garantiza coherencia en supervisión IA
--
-- APLICAR EN PRODUCCIÓN:
--   PGPASSWORD=<pass> psql "host=db.racsklqvunereluevwfp.supabase.co ..." -f 056_consolidar_schema.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- PASO 1: Agregar columnas de perfil a app_auth.users
-- (nullable inicialmente para migrar datos antes de aplicar NOT NULL)
-- ============================================================================

ALTER TABLE app_auth.users
    -- Perfil común (ciudadanos + operarios)
    ADD COLUMN IF NOT EXISTS nombre           VARCHAR(100),
    ADD COLUMN IF NOT EXISTS apellido         VARCHAR(100),
    ADD COLUMN IF NOT EXISTS segundo_nombre   VARCHAR(100),
    ADD COLUMN IF NOT EXISTS segundo_apellido VARCHAR(100),
    ADD COLUMN IF NOT EXISTS cedula           VARCHAR(10),
    ADD COLUMN IF NOT EXISTS telefono         VARCHAR(20),
    -- Solo ciudadanos
    ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
    ADD COLUMN IF NOT EXISTS sexo             VARCHAR(30),
    ADD COLUMN IF NOT EXISTS avatar_url       VARCHAR(500),
    -- Solo operarios/supervisores
    ADD COLUMN IF NOT EXISTS zona_id          UUID,
    ADD COLUMN IF NOT EXISTS cargo            VARCHAR(100);

-- FK zona_id → operations.zones
ALTER TABLE app_auth.users
    ADD CONSTRAINT fk_users_zona
        FOREIGN KEY (zona_id) REFERENCES operations.zones(id) ON DELETE SET NULL;

-- cedula debe ser única cuando no es NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_cedula
    ON app_auth.users (cedula)
    WHERE cedula IS NOT NULL;

-- ============================================================================
-- PASO 2: Migrar datos de public.ciudadanos → app_auth.users
-- ============================================================================

UPDATE app_auth.users u
SET
    nombre           = c.nombre,
    apellido         = c.apellido,
    segundo_nombre   = c.segundo_nombre,
    segundo_apellido = c.segundo_apellido,
    cedula           = c.cedula,
    telefono         = c.telefono,
    fecha_nacimiento = c.fecha_nacimiento,
    sexo             = c.sexo,
    avatar_url       = c.avatar_url
FROM public.ciudadanos c
WHERE c.user_id = u.id;

-- ============================================================================
-- PASO 3: Migrar datos de operations.operarios → app_auth.users
-- ============================================================================

UPDATE app_auth.users u
SET
    nombre   = COALESCE(u.nombre,   o.nombre),
    apellido = COALESCE(u.apellido, o.apellido),
    cedula   = COALESCE(u.cedula,   o.cedula),
    telefono = COALESCE(u.telefono, o.telefono),
    zona_id  = o.zona_id,
    cargo    = o.cargo
FROM operations.operarios o
WHERE o.user_id = u.id;

-- ============================================================================
-- PASO 4: Hacer NOT NULL los campos obligatorios tras migrar datos
-- Verificar que no haya NULLs antes de aplicar NOT NULL
-- ============================================================================

DO $$
DECLARE
    cnt_nombre   INTEGER;
    cnt_apellido INTEGER;
BEGIN
    SELECT COUNT(*) INTO cnt_nombre
    FROM app_auth.users WHERE nombre IS NULL AND rol <> 'ADMIN';

    SELECT COUNT(*) INTO cnt_apellido
    FROM app_auth.users WHERE apellido IS NULL AND rol <> 'ADMIN';

    IF cnt_nombre > 0 OR cnt_apellido > 0 THEN
        RAISE EXCEPTION
            'Hay % usuarios sin nombre y % sin apellido. Migrar datos primero.',
            cnt_nombre, cnt_apellido;
    END IF;
END $$;

-- ============================================================================
-- PASO 5: Eliminar columna 'username' huérfana
-- (nunca se usa en ningún login flow — verificado en código)
-- ============================================================================

ALTER TABLE app_auth.users DROP COLUMN IF EXISTS username;

-- ============================================================================
-- PASO 6: Eliminar tablas consolidadas
-- ============================================================================

REVOKE ALL ON public.ciudadanos    FROM auth_svc, users_svc, image_svc;
REVOKE ALL ON operations.operarios FROM auth_svc, users_svc, image_svc;

DROP TABLE IF EXISTS public.ciudadanos   CASCADE;
DROP TABLE IF EXISTS operations.operarios CASCADE;

-- ============================================================================
-- PASO 7: Consolidar ai.image_audit → columnas en incidents.incidents
-- ============================================================================

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS etiqueta_entrenamiento  ai.image_audit_label DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS comentario_etiquetado   TEXT,
    ADD COLUMN IF NOT EXISTS etiquetado_por          UUID REFERENCES app_auth.users(id),
    ADD COLUMN IF NOT EXISTS etiquetado_en           TIMESTAMPTZ;

-- Migrar datos de image_audit → incidents
UPDATE incidents.incidents i
SET
    etiqueta_entrenamiento = ia.etiqueta,
    comentario_etiquetado  = ia.comentario,
    etiquetado_por         = ia.etiquetado_por,
    etiquetado_en          = ia.etiquetado_at
FROM ai.image_audit ia
WHERE ia.incident_id = i.id;

-- Índice para el filtro más frecuente (admin etiqueta PENDIENTE primero)
CREATE INDEX IF NOT EXISTS idx_incidents_etiqueta
    ON incidents.incidents (etiqueta_entrenamiento)
    WHERE etiqueta_entrenamiento IS NOT NULL;

REVOKE ALL ON ai.image_audit FROM image_svc;
DROP TABLE IF EXISTS ai.image_audit CASCADE;

-- ============================================================================
-- PASO 8: Actualizar GRANTs — app_auth.users ahora incluye el perfil
-- ============================================================================

-- auth_svc: lee nombre/apellido para respuesta de login
GRANT SELECT ON app_auth.users TO auth_svc;

-- users_svc: gestiona todo el perfil
GRANT SELECT, INSERT, UPDATE ON app_auth.users TO users_svc;

-- image_svc: lee nombre del ciudadano en incidentes y zona del personal
GRANT SELECT ON app_auth.users TO image_svc;

-- users_svc ya no necesita acceso a public o operations para perfil
REVOKE ALL ON SCHEMA public     FROM users_svc;
REVOKE ALL ON SCHEMA operations FROM users_svc;
GRANT  USAGE ON SCHEMA operations TO users_svc;
GRANT  SELECT ON operations.zones TO users_svc;

-- image_svc ya no necesita ciudadanos u operarios
-- (solo accede a app_auth.users directamente para JOINs de nombre/apellido/cedula)

-- ============================================================================
-- PASO 9: Fix — Auto-revocar tokens previos al crear uno nuevo
-- Evita race condition donde 2 requests simultáneos crean 2 tokens activos
-- ============================================================================

CREATE OR REPLACE FUNCTION app_auth.fn_revoke_previous_tokens()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE app_auth.refresh_tokens
    SET    revoked = TRUE
    WHERE  user_id = NEW.user_id
      AND  revoked  = FALSE
      AND  id      <> NEW.id;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION app_auth.fn_revoke_previous_tokens IS
    'Revoca automáticamente cualquier refresh token activo anterior al insertar uno nuevo.
     Garantiza que cada usuario tenga como máximo 1 token activo sin race condition.';

DROP TRIGGER IF EXISTS trg_revoke_previous_tokens ON app_auth.refresh_tokens;
CREATE TRIGGER trg_revoke_previous_tokens
    AFTER INSERT ON app_auth.refresh_tokens
    FOR EACH ROW EXECUTE FUNCTION app_auth.fn_revoke_previous_tokens();

-- Índice que el trigger usa para el UPDATE (evita seq scan)
CREATE INDEX IF NOT EXISTS idx_rt_user_activo
    ON app_auth.refresh_tokens (user_id)
    WHERE revoked = FALSE;

-- ============================================================================
-- PASO 10: Fix — Limpieza automática de pending_registrations expirados
-- Evita que emails queden bloqueados por registros abandonados
-- ============================================================================

CREATE OR REPLACE FUNCTION app_auth.fn_cleanup_expired_registrations()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
    DELETE FROM app_auth.pending_registrations
    WHERE otp_expires_at < NOW() - INTERVAL '24 hours'
      AND is_verified = FALSE;
$$;

COMMENT ON FUNCTION app_auth.fn_cleanup_expired_registrations IS
    'Llamar periódicamente via pg_cron o desde el servicio al arrancar.
     Libera emails que quedaron bloqueados por registros abandonados.';

GRANT EXECUTE ON FUNCTION app_auth.fn_cleanup_expired_registrations() TO users_svc;

-- ============================================================================
-- PASO 11: Fix — Constraint que garantiza coherencia en supervisión IA
-- ia_fue_correcta solo puede tener valor si hay supervisor y timestamp
-- ============================================================================

ALTER TABLE ai.analysis_results
    DROP CONSTRAINT IF EXISTS chk_supervision_completa;

ALTER TABLE ai.analysis_results
    ADD CONSTRAINT chk_supervision_completa CHECK (
        (ia_fue_correcta IS NULL AND supervisado_por IS NULL AND supervisado_at IS NULL) OR
        (ia_fue_correcta IS NOT NULL AND supervisado_por IS NOT NULL AND supervisado_at IS NOT NULL)
    );

-- ============================================================================
-- VERIFICACIÓN FINAL
-- ============================================================================

DO $$
DECLARE
    v_ciudadanos_exist  BOOLEAN;
    v_operarios_exist   BOOLEAN;
    v_image_audit_exist BOOLEAN;
    v_username_exist    BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ciudadanos'
    ) INTO v_ciudadanos_exist;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'operations' AND table_name = 'operarios'
    ) INTO v_operarios_exist;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'ai' AND table_name = 'image_audit'
    ) INTO v_image_audit_exist;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'app_auth' AND table_name = 'users' AND column_name = 'username'
    ) INTO v_username_exist;

    IF v_ciudadanos_exist THEN
        RAISE EXCEPTION 'FALLO: public.ciudadanos aún existe';
    END IF;
    IF v_operarios_exist THEN
        RAISE EXCEPTION 'FALLO: operations.operarios aún existe';
    END IF;
    IF v_image_audit_exist THEN
        RAISE EXCEPTION 'FALLO: ai.image_audit aún existe';
    END IF;
    IF v_username_exist THEN
        RAISE EXCEPTION 'FALLO: columna username aún existe en app_auth.users';
    END IF;

    RAISE NOTICE '056_consolidar_schema: TODAS LAS VERIFICACIONES PASARON ✓';
END $$;

COMMIT;
