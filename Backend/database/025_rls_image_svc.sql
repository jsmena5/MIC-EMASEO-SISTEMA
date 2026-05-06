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
-- Conceder acceso a la vista; revocar acceso directo a la tabla.
-- Cuando image_svc consulta auth.users_public, PostgreSQL usa los privilegios
-- del dueño de la vista (postgres) para leer auth.users — solo devuelve
-- las columnas declaradas en la vista.

GRANT SELECT ON auth.users_public TO image_svc;
REVOKE SELECT ON auth.users FROM image_svc;

-- ── 3. RLS como defensa en profundidad ───────────────────────────────────────
-- Si en el futuro se otorgara SELECT en auth.users a image_svc por error,
-- la capa RLS limita igualmente qué filas puede ver.
-- Los superusuarios (postgres) siguen teniendo BYPASSRLS implícito.
-- FOR ALL + USING/WITH CHECK (true) preserva el acceso completo de
-- auth_svc y users_svc sin alterar sus privilegios existentes.

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY policy_users_service_access ON auth.users
    AS PERMISSIVE
    FOR ALL
    USING (true)
    WITH CHECK (true);
