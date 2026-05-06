-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 022
-- Funciones ARCO: Supresión y Portabilidad de datos personales
-- LOPDP Ecuador — Art. 17 (Supresión) · Art. 15/18 (Acceso y Portabilidad)
--
-- Dependencias:
--   01_init_schema.sql  — auth.users, public.ciudadanos, incidents.incidents
--   017_audit_schema.sql — audit.audit_log
--
-- Restricción de diseño:
--   incidents.incidents.reportado_por → auth.users ON DELETE RESTRICT.
--   Los incidentes son registros de gestión pública (no PII del ciudadano),
--   por lo que NO se eliminan: se preservan con la FK intacta tras la
--   anonimización del perfil.
-- ============================================================================

BEGIN;

-- ============================================================================
-- FUNCIÓN 1: auth.fn_anonymize_user
-- Derecho de Supresión / Cancelación — LOPDP Art. 17
--
-- Estrategia de unicidad:
--   email    → 'anon_<md5_12>@eliminado.invalid'   (UNIQUE en auth.users)
--   username → 'eliminado_<md5_12>'                 (UNIQUE en auth.users)
--   cedula   → primeros 10 chars del mismo MD5       (UNIQUE en ciudadanos)
--   El hash MD5 del UUID es determinístico e idempotente: llamar la función
--   dos veces sobre el mismo usuario no provoca conflicto de unicidad.
-- ============================================================================
CREATE OR REPLACE FUNCTION auth.fn_anonymize_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_hash     TEXT := MD5(p_user_id::text);   -- 32 hex chars, único por UUID
    v_actor_id UUID;
    v_anterior JSONB;
    v_exists   BOOLEAN;
BEGIN
    -- Verificar existencia del usuario
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id)
    INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'ARCO-SUPRESION: usuario % no encontrado', p_user_id;
    END IF;

    -- Capturar estado previo para el diff del audit log
    SELECT jsonb_build_object(
        'email',    email,
        'username', username,
        'estado',   estado
    )
    INTO v_anterior
    FROM auth.users
    WHERE id = p_user_id;

    -- Leer el actor de la sesión (SET LOCAL audit.actor_id = '<uuid>')
    -- Si no está definido (acción del sistema), queda NULL.
    BEGIN
        v_actor_id := current_setting('audit.actor_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;

    -- 1. Anonimizar credenciales en auth.users
    UPDATE auth.users
    SET
        email         = 'anon_' || LEFT(v_hash, 12) || '@eliminado.invalid',
        username      = 'eliminado_' || LEFT(v_hash, 12),
        password_hash = 'ELIMINADO',
        estado        = 'INACTIVO',
        is_verified   = FALSE,
        ultimo_login  = NULL
    WHERE id = p_user_id;

    -- 2. Anonimizar perfil en public.ciudadanos (si existe; un OPERARIO puede no tenerlo)
    --    cedula usa LEFT(hash, 10) para cumplir la restricción UNIQUE de VARCHAR(10)
    UPDATE public.ciudadanos
    SET
        nombre     = '[ELIMINADO]',
        apellido   = '[ELIMINADO]',
        cedula     = LEFT(v_hash, 10),
        telefono   = '[ELIMINADO]',
        avatar_url = NULL
    WHERE user_id = p_user_id;

    -- NOTA: operations.operarios también contiene PII (nombre, apellido, cedula).
    -- Si el sistema procesa solicitudes ARCO de personal operativo, extender
    -- esta función con un UPDATE adicional sobre operations.operarios.

    -- 3. Registrar en audit.audit_log
    INSERT INTO audit.audit_log (
        ocurrido_at, actor_id, accion,
        schema_name, table_name, row_pk, diff
    ) VALUES (
        NOW(), v_actor_id, 'ARCO-SUPRESION',
        'auth', 'users', p_user_id::text,
        jsonb_build_object(
            'antes',   v_anterior,
            'derecho', 'LOPDP Art. 17 - Derecho de supresión'
        )
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_anonymize_user falló para usuario %: %', p_user_id, SQLERRM;
END;
$$;

COMMENT ON FUNCTION auth.fn_anonymize_user(UUID) IS
    'ARCO - Derecho de Supresión (LOPDP Art. 17 Ecuador): anonimiza los datos personales '
    'de auth.users y public.ciudadanos sin eliminar incidentes (ON DELETE RESTRICT '
    'se respeta: los incidentes son registros de gestión, no PII del ciudadano). '
    'Registra la operación en audit.audit_log con accion = ''ARCO-SUPRESION''.';


-- ============================================================================
-- FUNCIÓN 2: auth.fn_export_user_data
-- Derecho de Acceso y Portabilidad — LOPDP Art. 15 y Art. 18
--
-- Devuelve JSONB con:
--   - Datos de identidad de auth.users  (excluye password_hash)
--   - Perfil de public.ciudadanos        (todos los campos)
--   - Incidencias reportadas con sus imágenes anidadas
-- Útil para responder solicitudes de acceso y portabilidad ARCO.
-- ============================================================================
CREATE OR REPLACE FUNCTION auth.fn_export_user_data(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user      JSONB;
    v_ciudadano JSONB;
    v_incidents JSONB;
    v_actor_id  UUID;
    v_exists    BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = p_user_id)
    INTO v_exists;

    IF NOT v_exists THEN
        RAISE EXCEPTION 'ARCO-ACCESO: usuario % no encontrado', p_user_id;
    END IF;

    -- Leer actor de sesión
    BEGIN
        v_actor_id := current_setting('audit.actor_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;

    -- auth.users: excluye password_hash (dato de seguridad, no PII exportable)
    SELECT jsonb_build_object(
        'id',           id,
        'email',        email,
        'username',     username,
        'rol',          rol,
        'estado',       estado,
        'is_verified',  is_verified,
        'ultimo_login', ultimo_login,
        'created_at',   created_at
    )
    INTO v_user
    FROM auth.users
    WHERE id = p_user_id;

    -- public.ciudadanos: todos los campos de perfil
    SELECT to_jsonb(c)
    INTO v_ciudadano
    FROM public.ciudadanos c
    WHERE user_id = p_user_id;

    -- incidents reportados + imágenes anidadas (orden cronológico descendente)
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id',          i.id,
                'descripcion', i.descripcion,
                'direccion',   i.direccion,
                'estado',      i.estado,
                'prioridad',   i.prioridad,
                'created_at',  i.created_at,
                'resuelto_at', i.resuelto_at,
                'imagenes', (
                    SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'image_url',    img.image_url,
                                'es_principal', img.es_principal
                            )
                            ORDER BY img.created_at
                        ),
                        '[]'::jsonb
                    )
                    FROM incidents.incident_images img
                    WHERE img.incident_id = i.id
                )
            )
            ORDER BY i.created_at DESC
        ),
        '[]'::jsonb
    )
    INTO v_incidents
    FROM incidents.incidents i
    WHERE i.reportado_por = p_user_id;

    -- Registrar el acceso en audit.audit_log
    INSERT INTO audit.audit_log (
        ocurrido_at, actor_id, accion,
        schema_name, table_name, row_pk, diff
    ) VALUES (
        NOW(), v_actor_id, 'ARCO-ACCESO',
        'auth', 'users', p_user_id::text,
        jsonb_build_object(
            'derecho', 'LOPDP Art. 15/18 - Derecho de acceso y portabilidad'
        )
    );

    RETURN jsonb_build_object(
        'exportado_at',   NOW(),
        'version_schema', '1.0',
        'usuario',        v_user,
        'ciudadano',      v_ciudadano,
        'incidents',      v_incidents
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_export_user_data falló para usuario %: %', p_user_id, SQLERRM;
END;
$$;

COMMENT ON FUNCTION auth.fn_export_user_data(UUID) IS
    'ARCO - Derecho de Acceso y Portabilidad (LOPDP Art. 15 y 18 Ecuador): devuelve un JSONB '
    'con todos los datos personales del usuario (auth.users sin password_hash, '
    'public.ciudadanos, incidents.incidents con imágenes). '
    'Registra la consulta en audit.audit_log con accion = ''ARCO-ACCESO''.';

COMMIT;
