-- Migración 059: unicidad por (email, rol) y (cedula, rol)
-- Permite que la misma persona tenga cuentas en distintos roles
-- (ej: ciudadano Y supervisor) usando el mismo correo o cédula.

-- 1. Eliminar constraints globales anteriores
ALTER TABLE app_auth.users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS app_auth.uq_users_cedula;

-- 2. Unicidad compuesta (email + rol)
CREATE UNIQUE INDEX uq_users_email_rol
    ON app_auth.users (email, rol);

-- 3. Unicidad compuesta (cedula + rol), solo filas con cédula
CREATE UNIQUE INDEX uq_users_cedula_rol
    ON app_auth.users (cedula, rol)
    WHERE cedula IS NOT NULL;
