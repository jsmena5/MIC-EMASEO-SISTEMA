-- ============================================================================
-- MIC-EMASEO — Migración: Verificación de Email
-- 006_otp_migration.sql
-- Ejecutar después de 005_user_profiles_migration.sql
-- ============================================================================

BEGIN;

-- Solo agrega is_verified a auth.users.
-- Los datos temporales del OTP van en pending_registrations (007).
ALTER TABLE auth.users
    ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN auth.users.is_verified IS 'TRUE cuando el ciudadano completó la verificación de email';

COMMIT;
