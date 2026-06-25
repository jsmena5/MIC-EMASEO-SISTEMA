-- Migración 062: permitir a users_svc actualizar incidents.incidents (re-zonificación)
--
-- CONTEXTO
-- El users-service ahora re-zonifica incidentes cuando se importan/editan zonas:
--   • POST /api/users/zonas/rezonificar  (endpoint manual con dry_run/solo_huerfanos)
--   • dentro de POST /api/users/zonas/import (re-zonifica los que caen en la zona nueva)
-- Ambos hacen `UPDATE incidents.incidents SET zona_id = ...`.
--
-- Pero la migración 012 (y la 040) solo otorgaron a users_svc:
--     GRANT USAGE  ON SCHEMA  incidents           TO users_svc;
--     GRANT SELECT ON incidents.incidents          TO users_svc;
-- Sin UPDATE, el endpoint falla con:
--     [zone] rezonificarIncidentes: permission denied for schema incidents
--
-- DECISIÓN
-- Conceder UPDATE sobre incidents.incidents a users_svc (además del SELECT que ya
-- tiene). Es el mínimo necesario: la re-zonificación solo escribe la columna zona_id
-- (y updated_at). No se otorga INSERT/DELETE: users_svc no crea ni borra incidentes,
-- esos los gestiona image_svc.
--
-- Reafirmamos también USAGE en el schema por idempotencia/robustez ante estados
-- parciales en el entorno gestionado (Supabase).
--
-- Idempotente: los GRANT son seguros de re-ejecutar.
-- Ejecutar como superusuario (postgres).

GRANT USAGE  ON SCHEMA incidents      TO users_svc;
GRANT SELECT, UPDATE ON incidents.incidents TO users_svc;
