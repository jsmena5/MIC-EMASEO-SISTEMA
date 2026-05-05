-- ============================================================================
-- 012_db_users_isolation.sql
-- Principio de mínimo privilegio: un usuario PostgreSQL por microservicio.
-- Ejecutar como superusuario (postgres) contra la base MIC-EMASEO.
-- ============================================================================

-- ── 1. Crear usuarios de base de datos ───────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_svc') THEN
    CREATE USER auth_svc WITH PASSWORD 'auth_svc_dev_2024'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'users_svc') THEN
    CREATE USER users_svc WITH PASSWORD 'users_svc_dev_2024'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'image_svc') THEN
    CREATE USER image_svc WITH PASSWORD 'image_svc_dev_2024'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  END IF;
END;
$$;

-- ── 2. auth_svc ──────────────────────────────────────────────────────────────
-- Dueño de su propio schema. Necesita leer public.ciudadanos y
-- operations.operarios para completar el payload del JWT (nombre/apellido).

GRANT USAGE ON SCHEMA auth        TO auth_svc;
GRANT USAGE ON SCHEMA public      TO auth_svc;
GRANT USAGE ON SCHEMA operations  TO auth_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth       TO auth_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth                     TO auth_svc;

-- Solo lectura de los datos de perfil que el login necesita
GRANT SELECT ON public.ciudadanos        TO auth_svc;
GRANT SELECT ON operations.operarios     TO auth_svc;

-- Cubrir tablas futuras en el schema auth
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO auth_svc;

-- ── 3. users_svc ─────────────────────────────────────────────────────────────
-- Gestiona alta y edición de ciudadanos (public) y staff (operations).
-- Necesita leer/escribir auth.users para crear el usuario base en el registro.
-- Necesita leer auth.pending_registrations y tokens para el flujo de OTP.

GRANT USAGE ON SCHEMA public      TO users_svc;
GRANT USAGE ON SCHEMA operations  TO users_svc;
GRANT USAGE ON SCHEMA auth        TO users_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public     TO users_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public                   TO users_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operations TO users_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operations               TO users_svc;

-- Escritura en auth.users (INSERT al registrar, UPDATE al cambiar estado/password)
GRANT SELECT, INSERT, UPDATE ON auth.users                              TO users_svc;
-- Tablas de flujo de registro y OTP
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.pending_registrations      TO users_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations
  GRANT USAGE, SELECT ON SEQUENCES TO users_svc;

-- ── 4. image_svc ─────────────────────────────────────────────────────────────
-- Gestiona incidentes (incidents.*), resultados IA (ai.*) y notificaciones push.
-- Solo lectura de perfiles y zonas de los otros schemas.

GRANT USAGE ON SCHEMA incidents     TO image_svc;
GRANT USAGE ON SCHEMA ai            TO image_svc;
GRANT USAGE ON SCHEMA notifications TO image_svc;
GRANT USAGE ON SCHEMA public        TO image_svc;
GRANT USAGE ON SCHEMA auth          TO image_svc;
GRANT USAGE ON SCHEMA operations    TO image_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA incidents     TO image_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA incidents                   TO image_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai            TO image_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ai                          TO image_svc;

-- Solo INSERT en notifications (el trigger fn_notify_citizen corre como image_svc)
GRANT INSERT ON notifications.notifications                                TO image_svc;

-- Solo lectura de entidades de otros servicios (joins en listados/detalle)
GRANT SELECT ON public.ciudadanos                                          TO image_svc;
GRANT SELECT ON auth.users                                                 TO image_svc;
GRANT SELECT ON operations.zones                                           TO image_svc;
GRANT SELECT ON operations.operarios                                       TO image_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA incidents
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO image_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA incidents
  GRANT USAGE, SELECT ON SEQUENCES TO image_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO image_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai
  GRANT USAGE, SELECT ON SEQUENCES TO image_svc;

-- ── 5. Revocar acceso público por defecto ─────────────────────────────────────
-- PostgreSQL otorga CONNECT a PUBLIC por defecto; lo revocamos y re-otorgamos
-- solo a los usuarios que realmente deben conectarse.

REVOKE CONNECT ON DATABASE "MIC-EMASEO" FROM PUBLIC;
GRANT  CONNECT ON DATABASE "MIC-EMASEO" TO auth_svc, users_svc, image_svc, postgres;
