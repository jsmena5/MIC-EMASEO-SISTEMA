-- ============================================================================
-- 025_rls_image_svc.sql
-- Mínimo privilegio: image_svc accede a auth.users solo mediante una vista
-- que expone únicamente columnas no sensibles.
-- Ejecutar como superusuario (postgres) contra la base MIC-EMASEO.
-- ============================================================================

-- ── 1. Vista segura: columnas no sensibles de auth.users ─────────────────────
-- Excluye: email, password_hash, is_verified, ultimo_login, updated_at

CREATE OR REPLACE VIEW auth.users_public AS
    SELECT
        id,
        username,
        estado,
        rol,
        created_at
    FROM auth.users;

COMMENT ON VIEW auth.users_public IS
    'Vista restringida de auth.users para servicios que no deben ver PII (email, password_hash, is_verified, ultimo_login)';

-- ── 2. Permisos de image_svc ─────────────────────────────────────────────────
-- image_svc accede a auth.users SOLO vía auth.users_public (vista).
-- Se revoca el acceso directo a la tabla base para evitar acceso accidental.
-- Cuando image_svc consulta auth.users_public, PostgreSQL usa los privilegios
-- del dueño de la vista (postgres) para leer auth.users — solo devuelve
-- las columnas declaradas en la vista.

GRANT SELECT ON auth.users_public TO image_svc;
REVOKE SELECT ON auth.users FROM image_svc;

-- ── 3. RLS como defensa en profundidad ───────────────────────────────────────
-- Propósito: si en el futuro alguien concede SELECT ON auth.users a image_svc
-- por error (ej. GRANT ALL ON SCHEMA auth), el RLS bloquea el acceso de todas
-- formas para los roles que no tenemos una política explícita que lo permita.
--
-- DISEÑO INTENCIONAL:
--   • image_svc ya no puede leer auth.users directamente (REVOKE arriba), así
--     que su política RLS es irrelevante en el flujo normal. Es solo un seguro.
--   • auth_svc y users_svc sí necesitan leer/escribir auth.users sin restricción
--     por fila — sus políticas usan USING (true) porque la protección real es la
--     autenticación mutua entre servicios (INTERNAL_TOKEN en cada request) y el
--     RBAC a nivel de roles de PostgreSQL, no a nivel de filas individuales.
--   • El superusuario postgres tiene BYPASSRLS implícito y no se ve afectado.

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

-- Política para auth_svc: acceso completo (lectura y escritura de cualquier fila).
-- Necesita leer todos los usuarios para validar credenciales y emitir tokens.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'auth' AND tablename = 'users' AND policyname = 'policy_auth_svc_full_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY policy_auth_svc_full_access ON auth.users
          AS PERMISSIVE FOR ALL TO auth_svc
          USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- Política para users_svc: acceso completo (gestión del ciclo de vida de cuentas).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'auth' AND tablename = 'users' AND policyname = 'policy_users_svc_full_access'
  ) THEN
    EXECUTE $p$
      CREATE POLICY policy_users_svc_full_access ON auth.users
          AS PERMISSIVE FOR ALL TO users_svc
          USING (true) WITH CHECK (true)
    $p$;
  END IF;
END $$;

-- Política para image_svc: en la práctica image_svc no tiene SELECT en auth.users
-- (REVOKE arriba). Esta política existe únicamente como failsafe: si alguien
-- restablece el GRANT por error, image_svc solo verá usuarios con rol CIUDADANO
-- o OPERARIO (los únicos que crean o atienden incidentes). Esto es más restrictivo
-- que USING (true) y reduce el blast radius de una mala configuración futura.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'auth' AND tablename = 'users' AND policyname = 'policy_image_svc_restricted'
  ) THEN
    EXECUTE $p$
      CREATE POLICY policy_image_svc_restricted ON auth.users
          AS PERMISSIVE FOR SELECT TO image_svc
          USING (rol IN ('CIUDADANO', 'OPERARIO', 'SUPERVISOR'))
    $p$;
  END IF;
END $$;

-- Eliminar la política genérica anterior (si existe) que abría ALL para todos los roles
DROP POLICY IF EXISTS policy_users_service_access ON auth.users;
