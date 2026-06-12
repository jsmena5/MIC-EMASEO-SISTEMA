-- Agrega los campos demográficos al registro pendiente para que viajen del
-- paso 1 (registro) al paso 3 (set-password) y se persistan en public.ciudadanos.
-- Idempotente.

ALTER TABLE app_auth.pending_registrations
  ADD COLUMN IF NOT EXISTS telefono         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE,
  ADD COLUMN IF NOT EXISTS sexo             VARCHAR(30);
