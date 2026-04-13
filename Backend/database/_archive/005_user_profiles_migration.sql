-- ============================================================================
-- MIC-EMASEO — Migración: Separación de Perfiles de Usuario
-- 005_user_profiles_migration.sql
-- Ejecutar después de 004_improvements.sql
-- Objetivo: auth.users = solo credenciales; perfiles en tablas dedicadas
-- ============================================================================
-- Resultado final de auth.users:
--   id | email | username | password_hash | rol | estado | ultimo_login | timestamps
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- PASO 1: Crear tabla de perfil para CIUDADANOS (dominio: app móvil)
-- Relación 1:1 con auth.users — ON DELETE CASCADE garantiza que si
-- se elimina la credencial, el perfil desaparece automáticamente.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE public.ciudadanos (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    apellido    VARCHAR(100) NOT NULL,
    cedula      VARCHAR(10)  NOT NULL UNIQUE,
    telefono    VARCHAR(15),
    avatar_url  VARCHAR(500),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.ciudadanos          IS 'Perfil del ciudadano vinculado 1:1 con auth.users — gestionado por la app móvil';
COMMENT ON COLUMN public.ciudadanos.user_id  IS 'FK a auth.users(id) — tabla de identidad/credenciales';
COMMENT ON COLUMN public.ciudadanos.cedula   IS 'Cédula ecuatoriana de 10 dígitos — UNIQUE en toda la tabla';

-- ─────────────────────────────────────────────────────────────────
-- PASO 2: Crear tabla de perfil para PERSONAL OPERATIVO (dominio: web)
-- Cubre roles: OPERARIO, SUPERVISOR, ADMIN
-- zona_id es opcional: un ADMIN puede no tener zona asignada.
-- cargo describe el puesto laboral (ej: "Supervisor Zona Norte").
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE operations.operarios (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    apellido    VARCHAR(100) NOT NULL,
    cedula      VARCHAR(10)  NOT NULL UNIQUE,
    telefono    VARCHAR(15),
    zona_id     UUID         REFERENCES operations.zones(id) ON DELETE SET NULL,
    cargo       VARCHAR(100),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  operations.operarios         IS 'Perfil del personal operativo (OPERARIO/SUPERVISOR/ADMIN) — gestionado por el sistema web';
COMMENT ON COLUMN operations.operarios.user_id IS 'FK a auth.users(id) — tabla de identidad/credenciales';
COMMENT ON COLUMN operations.operarios.zona_id IS 'Zona operativa asignada (opcional para ADMIN)';
COMMENT ON COLUMN operations.operarios.cargo   IS 'Puesto laboral descriptivo, ej: "Supervisor Zona Norte"';

-- ─────────────────────────────────────────────────────────────────
-- PASO 3: Migrar datos existentes de auth.users a los nuevos perfiles
-- Se usan los valores exactos de auth.users para preservar integridad.
-- ─────────────────────────────────────────────────────────────────

-- Migrar ciudadanos (rol = 'CIUDADANO')
INSERT INTO public.ciudadanos
    (user_id, nombre, apellido, cedula, telefono, avatar_url, created_at, updated_at)
SELECT id, nombre, apellido, cedula, telefono, avatar_url, created_at, updated_at
FROM auth.users
WHERE rol = 'CIUDADANO';

-- Migrar personal operativo (roles = OPERARIO, SUPERVISOR, ADMIN)
INSERT INTO operations.operarios
    (user_id, nombre, apellido, cedula, telefono, created_at, updated_at)
SELECT id, nombre, apellido, cedula, telefono, created_at, updated_at
FROM auth.users
WHERE rol IN ('OPERARIO', 'SUPERVISOR', 'ADMIN');

-- Verificación interna de la migración (abortará el bloque si hay discrepancias)
DO $$
DECLARE
    v_ciudadanos_origen   INT;
    v_ciudadanos_destino  INT;
    v_operarios_origen    INT;
    v_operarios_destino   INT;
BEGIN
    SELECT COUNT(*) INTO v_ciudadanos_origen  FROM auth.users WHERE rol = 'CIUDADANO';
    SELECT COUNT(*) INTO v_ciudadanos_destino FROM public.ciudadanos;
    SELECT COUNT(*) INTO v_operarios_origen   FROM auth.users WHERE rol IN ('OPERARIO','SUPERVISOR','ADMIN');
    SELECT COUNT(*) INTO v_operarios_destino  FROM operations.operarios;

    IF v_ciudadanos_origen <> v_ciudadanos_destino THEN
        RAISE EXCEPTION 'Migración fallida: ciudadanos origen=% destino=%',
            v_ciudadanos_origen, v_ciudadanos_destino;
    END IF;

    IF v_operarios_origen <> v_operarios_destino THEN
        RAISE EXCEPTION 'Migración fallida: operarios origen=% destino=%',
            v_operarios_origen, v_operarios_destino;
    END IF;

    RAISE NOTICE 'Migración verificada: % ciudadanos y % operarios migrados correctamente.',
        v_ciudadanos_destino, v_operarios_destino;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- PASO 4: Limpiar auth.users — eliminar columnas de perfil
-- auth.users queda como tabla de identidad/credenciales pura.
-- NOTA: Las FK externas (reportado_por, operario_id, supervisor_id,
-- usuario_id, cambiado_por) siguen apuntando a auth.users(id) —
-- NO SE MODIFICAN, ya que el ancla de identidad permanece intacta.
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users
    DROP COLUMN nombre,
    DROP COLUMN apellido,
    DROP COLUMN cedula,
    DROP COLUMN telefono,
    DROP COLUMN avatar_url;

-- Actualizar comentario de tabla para reflejar su nuevo rol
COMMENT ON TABLE auth.users IS
    'Tabla de identidad y credenciales — solo datos de autenticación. Perfiles en public.ciudadanos y operations.operarios';

-- ─────────────────────────────────────────────────────────────────
-- PASO 5: Índices en tablas de perfiles
-- ─────────────────────────────────────────────────────────────────
-- Búsqueda por cédula en ciudadanos (ej: verificar duplicados en registro)
CREATE INDEX idx_ciudadanos_cedula ON public.ciudadanos (cedula);

-- Búsqueda por cédula en operarios
CREATE INDEX idx_operarios_cedula  ON operations.operarios (cedula);

-- Filtrar operarios por zona asignada (ej: listar personal de una zona)
CREATE INDEX idx_operarios_zona    ON operations.operarios (zona_id);

-- ─────────────────────────────────────────────────────────────────
-- PASO 6: Triggers de updated_at para nuevas tablas
-- Reutiliza la función auxiliar definida en 001_schema.sql
-- ─────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_ciudadanos_updated_at
    BEFORE UPDATE ON public.ciudadanos
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_operarios_updated_at
    BEFORE UPDATE ON operations.operarios
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar manualmente para confirmar)
-- ============================================================================
-- SELECT COUNT(*) AS ciudadanos FROM public.ciudadanos;
-- SELECT COUNT(*) AS operarios  FROM operations.operarios;
-- SELECT column_name FROM information_schema.columns
--     WHERE table_schema = 'auth' AND table_name = 'users'
--     ORDER BY ordinal_position;
-- ============================================================================
