-- ============================================================================
-- 040_register_profile_fields_and_ciudadano_count.sql
-- Amplia el registro ciudadano con fecha de nacimiento, sexo y celular.
-- También habilita a users_svc a leer incidents.incidents para el conteo de
-- reportes en el panel administrativo.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('app_auth.pending_registrations') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE app_auth.pending_registrations
        ADD COLUMN IF NOT EXISTS telefono VARCHAR(15),
        ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
        ADD COLUMN IF NOT EXISTS sexo VARCHAR(30)
    ';
  ELSIF to_regclass('auth.pending_registrations') IS NOT NULL THEN
    EXECUTE '
      ALTER TABLE auth.pending_registrations
        ADD COLUMN IF NOT EXISTS telefono VARCHAR(15),
        ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
        ADD COLUMN IF NOT EXISTS sexo VARCHAR(30)
    ';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA incidents TO users_svc;
GRANT SELECT ON incidents.incidents TO users_svc;
