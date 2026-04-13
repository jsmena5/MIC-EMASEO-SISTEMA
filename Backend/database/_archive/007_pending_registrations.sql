-- ============================================================================
-- MIC-EMASEO — Migración: Tabla de registros pendientes
-- 007_pending_registrations.sql
-- Ejecutar después de 006_otp_migration.sql
-- ============================================================================

BEGIN;

-- Almacena datos del ciudadano mientras completa el flujo de 3 pasos:
-- 1. pre-registro (datos + envío OTP)
-- 2. verificación OTP
-- 3. creación de contraseña
-- Una vez completado el paso 3, la fila se elimina y los datos van a
-- auth.users + public.ciudadanos.
CREATE TABLE public.pending_registrations (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(100) NOT NULL,
    apellido        VARCHAR(100) NOT NULL,
    cedula          VARCHAR(10)  NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    otp_code        VARCHAR(6),
    otp_expires_at  TIMESTAMPTZ,
    is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pending_registrations IS 'Registros en proceso de verificación — se eliminan al completar el registro';

-- Limpiar registros viejos sin verificar (para mantenimiento)
CREATE INDEX idx_pending_created_at ON public.pending_registrations (created_at);

COMMIT;
