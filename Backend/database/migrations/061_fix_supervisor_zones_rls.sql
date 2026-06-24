-- Migración 061: desactivar RLS en operations.supervisor_zones
--
-- CONTEXTO
-- La migración 060 creó operations.supervisor_zones con RLS habilitado pero SIN
-- ninguna policy. En PostgreSQL, RLS activo + cero policies = deny-all para todo
-- rol que no sea superusuario/BYPASSRLS. Resultado: users_svc (que tiene GRANT
-- INSERT/UPDATE/DELETE/SELECT correctos) era vetado por RLS al asignar un
-- supervisor a una zona:
--
--   [zone] updateZona: new row violates row-level security policy
--                      for table "supervisor_zones"
--
-- Esto rompía DOS cosas a la vez:
--   1. Guardar la asignación de supervisor desde el panel admin (PUT /zonas/:id → 500).
--   2. La lectura del panel de supervisores: como el INSERT nunca prosperaba, la
--      junction quedaba vacía y los supervisores aparecían "Sin zona".
--
-- DECISIÓN
-- operations.zones (la tabla padre de esta relación) NO usa RLS, ni el resto del
-- esquema operations. La seguridad real aquí la dan: (a) los GRANT por servicio y
-- (b) el scoping por rol en el código (WHERE supervisor_id = $1). RLS en esta
-- junction no aporta defensa real y solo introduce este fallo. Se desactiva para
-- dejarla consistente con su tabla padre.
--
-- Idempotente: ALTER TABLE ... DISABLE es seguro de re-ejecutar.
-- Ejecutar como superusuario (postgres).

ALTER TABLE operations.supervisor_zones DISABLE ROW LEVEL SECURITY;

-- Por higiene: eliminar cualquier policy huérfana que pudiera haberse creado.
-- (Hoy no existe ninguna — verificado con pg_policy — pero esto deja la tabla
--  en un estado limpio y hace la migración robusta ante estados parciales.)
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'operations.supervisor_zones'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON operations.supervisor_zones', pol.polname);
  END LOOP;
END $$;
