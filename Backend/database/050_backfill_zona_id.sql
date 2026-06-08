-- Migración 050: Asigna zona_id retroactivamente a incidentes existentes sin zona.
--
-- El INSERT_INCIDENT_SQL original no incluía zona_id, por lo que todos los incidentes
-- creados antes de este fix tienen zona_id = NULL aunque sus coordenadas caigan
-- dentro de los polígonos de operations.zones.
--
-- Esta migración hace el backfill y corrige también el INSERT del image-service.
--
-- Aplica en producción (desde el VPS):
--   PGPASSWORD=$DB_PASSWORD psql "host=<supabase_host> port=5432 dbname=postgres \
--     user=postgres sslmode=require" -f Backend/database/050_backfill_zona_id.sql

UPDATE incidents.incidents i
SET zona_id = (
    SELECT z.id
    FROM operations.zones z
    WHERE ST_Within(i.ubicacion::geometry, z.geom)
      AND z.activa = TRUE
    ORDER BY z.id
    LIMIT 1
)
WHERE i.zona_id IS NULL
  AND i.ubicacion IS NOT NULL;

-- Resultado esperado: actualiza ~167 filas con zona asignada, deja NULL solo
-- los incidentes cuyas coordenadas caen fuera de todos los polígonos.
