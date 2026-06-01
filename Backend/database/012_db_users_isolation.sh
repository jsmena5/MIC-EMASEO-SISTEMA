#!/bin/bash
# =============================================================================
# 012_db_users_isolation.sh
# Principio de mínimo privilegio: un usuario PostgreSQL por microservicio.
#
# Ejecutado automáticamente por el entrypoint de postgres:16 al primer inicio
# del volumen (todos los scripts *.sh en /docker-entrypoint-initdb.d/).
#
# Variables requeridas (inyectadas por docker-compose desde el .env):
#   DB_PASSWORD_AUTH   — contraseña para auth_svc
#   DB_PASSWORD_USERS  — contraseña para users_svc
#   DB_PASSWORD_IMAGE  — contraseña para image_svc
#   POSTGRES_USER      — superusuario de Postgres (ej. postgres)
#   POSTGRES_DB        — nombre de la base de datos (ej. MIC-EMASEO)
# =============================================================================
set -euo pipefail

# ── Validar que las contraseñas estén definidas ───────────────────────────────
# La sintaxis ${VAR:?mensaje} aborta con error si VAR está vacía o no definida.
: "${DB_PASSWORD_AUTH:?ERROR: DB_PASSWORD_AUTH no está definida en el .env}"
: "${DB_PASSWORD_USERS:?ERROR: DB_PASSWORD_USERS no está definida en el .env}"
: "${DB_PASSWORD_IMAGE:?ERROR: DB_PASSWORD_IMAGE no está definida en el .env}"

# ── Escapar comillas simples para SQL ('' → escape estándar SQL) ──────────────
sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }

PW_AUTH=$(sql_escape "$DB_PASSWORD_AUTH")
PW_USERS=$(sql_escape "$DB_PASSWORD_USERS")
PW_IMAGE=$(sql_escape "$DB_PASSWORD_IMAGE")

echo "==> Creando roles de servicio con mínimo privilegio..."

# ── Ejecutar SQL (heredoc sin comillas → bash expande las variables PW_*) ─────
# Los $$ del PL/pgSQL se escapan como \$\$ para que bash no los interprete
# como el PID del proceso.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" << SQL

-- ── 1. Crear usuarios de base de datos ────────────────────────────────────────
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_svc') THEN
    CREATE USER auth_svc WITH PASSWORD '$PW_AUTH'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  ELSE
    ALTER USER auth_svc WITH PASSWORD '$PW_AUTH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'users_svc') THEN
    CREATE USER users_svc WITH PASSWORD '$PW_USERS'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  ELSE
    ALTER USER users_svc WITH PASSWORD '$PW_USERS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'image_svc') THEN
    CREATE USER image_svc WITH PASSWORD '$PW_IMAGE'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
  ELSE
    ALTER USER image_svc WITH PASSWORD '$PW_IMAGE';
  END IF;
END;
\$\$;

-- ── 2. auth_svc ──────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA auth        TO auth_svc;
GRANT USAGE ON SCHEMA public      TO auth_svc;
GRANT USAGE ON SCHEMA operations  TO auth_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth       TO auth_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth                     TO auth_svc;

GRANT SELECT ON public.ciudadanos        TO auth_svc;
GRANT SELECT ON operations.operarios     TO auth_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO auth_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT USAGE, SELECT ON SEQUENCES TO auth_svc;

-- ── 3. users_svc ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public      TO users_svc;
GRANT USAGE ON SCHEMA operations  TO users_svc;
GRANT USAGE ON SCHEMA auth        TO users_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public     TO users_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public                   TO users_svc;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA operations TO users_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA operations               TO users_svc;

GRANT SELECT, INSERT, UPDATE ON auth.users                              TO users_svc;
GRANT USAGE ON SCHEMA incidents                                         TO users_svc;
GRANT SELECT ON incidents.incidents                                     TO users_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_registrations    TO users_svc;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO users_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA operations
  GRANT USAGE, SELECT ON SEQUENCES TO users_svc;

-- ── 4. image_svc ─────────────────────────────────────────────────────────────
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

GRANT INSERT ON notifications.notifications                                TO image_svc;

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
REVOKE CONNECT ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
GRANT  CONNECT ON DATABASE "$POSTGRES_DB" TO auth_svc, users_svc, image_svc, postgres;

SQL

echo "==> Roles de servicio creados correctamente."
