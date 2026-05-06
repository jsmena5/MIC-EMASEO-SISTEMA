-- ============================================================================
-- 020_pending_registrations_to_auth.sql
-- Mueve public.pending_registrations al schema auth, donde conceptualmente
-- pertenece (identidad/autenticacion), junto con refresh_tokens y
-- password_reset_tokens.
--
-- La migracion 012_db_users_isolation.sql ya referencio auth.pending_registrations
-- en su GRANT (linea 65), lo que indica que el diseno original preveia esta tabla
-- en auth. Esta migracion corrige la discrepancia.
--
-- Ejecutar como superusuario (postgres) contra la base MIC-EMASEO.
-- ============================================================================

-- 1. Mover la tabla al schema auth.
--    PostgreSQL mueve automaticamente todos los indices y constraints asociados
--    (idx_pending_created_at, la UNIQUE constraint de email, el PK).
ALTER TABLE public.pending_registrations SET SCHEMA auth;

-- 2. Otorgar privilegios a users_svc sobre la tabla en su nuevo schema.
--    El GRANT previo "ALL TABLES IN SCHEMA public" ya no cubre esta tabla.
--    El GRANT equivalente en 012_db_users_isolation.sql fallaba porque la tabla
--    aun no existia en auth; esta sentencia lo concreta.
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.pending_registrations TO users_svc;
