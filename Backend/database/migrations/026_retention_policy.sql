-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 026
-- Política de retención de datos (LOPDP / LOTAIP)
--
-- Retenciones configuradas:
--   auth.pending_registrations  → máximo 24 horas  (datos temporales de registro)
--   auth.password_reset_tokens  → según expires_at  (expiran a los 15 min por diseño)
--   auth.refresh_tokens         → según expires_at  (más tokens revocados)
--   incidents.incidents         → mínimo 7 años    (LOTAIP Art. 10 — registros públicos)
--
-- Dependencias:
--   008_refresh_tokens.sql       → auth.cleanup_expired_refresh_tokens()
--   009_password_reset_tokens.sql → auth.cleanup_expired_reset_tokens()
--   020_pending_registrations_to_auth.sql → auth.pending_registrations
--
-- pg_cron: disponible en Cloud SQL (PostgreSQL) y Amazon RDS.
-- Para habilitar: CREATE EXTENSION IF NOT EXISTS pg_cron;  (requiere superusuario)
-- ============================================================================

-- Habilitar pg_cron si está disponible en el entorno (comentar si no aplica):
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- Función consolidada de limpieza de datos expirados
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_cleanup_expired_data()
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
    v_pending  BIGINT;
    v_tokens   BIGINT;
    v_refresh  BIGINT;
BEGIN
    -- 1. Registros de pre-registro incompletos con más de 24 horas
    --    Tabla movida a auth por 020_pending_registrations_to_auth.sql
    DELETE FROM auth.pending_registrations
    WHERE created_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS v_pending = ROW_COUNT;

    -- 2. Tokens OTP de recuperación de contraseña vencidos o ya usados
    --    Delega a función dedicada creada en 009_password_reset_tokens.sql
    PERFORM auth.cleanup_expired_reset_tokens();
    -- Conteo aproximado post-limpieza para el log
    SELECT COUNT(*) INTO v_tokens
    FROM auth.password_reset_tokens
    WHERE expires_at < NOW() OR used = TRUE;

    -- 3. Refresh tokens expirados o revocados
    --    Delega a función dedicada creada en 008_refresh_tokens.sql
    PERFORM auth.cleanup_expired_refresh_tokens();
    SELECT COUNT(*) INTO v_refresh
    FROM auth.refresh_tokens
    WHERE expires_at < NOW() OR revoked = TRUE;

    RAISE NOTICE '[fn_cleanup_expired_data] %  — pending_registrations eliminados: %, '
                 'reset_tokens residuales: %, refresh_tokens residuales: %',
                 NOW(), v_pending, v_tokens, v_refresh;
END;
$$;

COMMENT ON FUNCTION public.fn_cleanup_expired_data() IS
    'Limpieza automática LOPDP: elimina datos temporales expirados según política de retención. '
    'Invoca auth.cleanup_expired_reset_tokens() y auth.cleanup_expired_refresh_tokens() (migraciones 008-009).';

-- ============================================================================
-- Índice de soporte para la limpieza de pending_registrations
-- (ya creado en 01_init_schema.sql como idx_pending_created_at; se omite aquí)
-- ============================================================================

-- ============================================================================
-- Programación via pg_cron — descomentar cuando la extensión esté habilitada
--
-- Ejecución diaria a las 03:00 hora Ecuador (UTC-5) = 08:00 UTC
-- ============================================================================
-- SELECT cron.schedule(
--     'cleanup-expired-data',     -- nombre del job (único)
--     '0 8 * * *',                -- cron: 08:00 UTC = 03:00 ECT (UTC-5)
--     'SELECT public.fn_cleanup_expired_data()'
-- );

-- ============================================================================
-- Alternativa sin pg_cron: llamada manual o desde un job externo (pg_agent,
-- AWS EventBridge, Cloud Scheduler, etc.)
--
--   CALL public.fn_cleanup_expired_data();
--   -- o equivalentemente:
--   SELECT public.fn_cleanup_expired_data();
-- ============================================================================

-- ============================================================================
-- Nota LOTAIP (Ley Orgánica de Transparencia — Art. 10):
-- incidents.incidents debe conservarse MÍNIMO 7 años.
-- NO se programa borrado automático de incidentes; la purga requiere
-- autorización explícita y proceso administrativo documentado.
-- Referencia futura: revisar política de archivo pasados 7 años.
-- ============================================================================
