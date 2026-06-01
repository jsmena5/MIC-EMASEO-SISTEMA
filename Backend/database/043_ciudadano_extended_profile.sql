-- Extiende public.ciudadanos con campos de perfil adicionales.
-- Extiende app_auth.pending_registrations para pasar nombres completos por el flujo de registro.
-- Idempotente: ADD COLUMN IF NOT EXISTS.

ALTER TABLE public.ciudadanos
  ADD COLUMN IF NOT EXISTS segundo_nombre   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS segundo_apellido VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
  ADD COLUMN IF NOT EXISTS sexo             VARCHAR(30);

ALTER TABLE app_auth.pending_registrations
  ADD COLUMN IF NOT EXISTS segundo_nombre   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS segundo_apellido VARCHAR(100);

COMMENT ON COLUMN public.ciudadanos.segundo_nombre   IS 'Segundo nombre (opcional)';
COMMENT ON COLUMN public.ciudadanos.segundo_apellido IS 'Segundo apellido (apellido materno)';
COMMENT ON COLUMN public.ciudadanos.fecha_nacimiento IS 'Fecha de nacimiento — actualizable desde el perfil';
COMMENT ON COLUMN public.ciudadanos.sexo             IS 'Masculino | Femenino | Otro | Prefiero no decir';
