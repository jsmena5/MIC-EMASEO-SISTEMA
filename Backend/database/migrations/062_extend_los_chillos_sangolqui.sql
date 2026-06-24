-- Migración 062: extender la zona "Los Chillos" para abarcar Sangolquí (cantón Rumiñahui)
--
-- CONTEXTO
-- La zona del Valle de Los Chillos (código ZN-LOS-CHILLOS, o ZN-ORIENTE-01 en el
-- seed de respaldo 058) cubría el área del valle dentro del DMQ, pero su polígono
-- no alcanzaba el núcleo urbano de Sangolquí / San Rafael / Cotogchoa / Alangasí.
-- Esa área pertenece al cantón Rumiñahui (fuera del DMQ), pero se necesita cubrirla
-- porque ahí se ubica la universidad usada para las pruebas del sistema. Sin esta
-- cobertura, los reportes hechos en Sangolquí caían en la zona más cercana por el
-- fallback de ST_Distance (createIncident), no en Los Chillos.
--
-- DECISIÓN
-- En lugar de REEMPLAZAR el polígono (riesgoso: el polígono real en producción fue
-- ajustado en vivo el 2026-06-18 —fix La Merced— y no coincide exactamente con
-- ningún archivo del repo), lo EXTENDEMOS con ST_Union del rectángulo de Sangolquí.
-- Así el área nueva se suma a lo que ya exista, sea cual sea la geometría actual.
-- Esto es robusto frente al config drift de producción.
--
-- El rectángulo cubre el casco urbano del cantón Rumiñahui:
--   Sangolquí, San Rafael, San Pedro del Tingo, Alangasí (N), Cotogchoa (S).
--   Bounding box: lon [-78.470, -78.395], lat [-0.375, -0.270]  (WGS84 / SRID 4326).
--
-- Idempotente: ST_Union es seguro de re-ejecutar (unir un área ya contenida es un
-- no-op geométrico). El match por código contempla ambos nombres posibles de la zona.
-- Ejecutar como superusuario (postgres).

BEGIN;

-- Rectángulo de Sangolquí (cantón Rumiñahui urbano).
-- ST_MakeEnvelope(xmin, ymin, xmax, ymax, srid) ya devuelve la geometría con SRID.
WITH sangolqui AS (
  SELECT ST_MakeEnvelope(-78.470, -0.375, -78.395, -0.270, 4326) AS geom
)
UPDATE operations.zones z
SET geom = ST_Multi(
             ST_MakeValid(
               ST_Union(z.geom, (SELECT geom FROM sangolqui))
             )
           ),
    descripcion = COALESCE(z.descripcion, '') ||
                  CASE WHEN z.descripcion LIKE '%Sangolquí%' THEN ''
                       ELSE ' + Sangolquí (Rumiñahui) para cobertura de pruebas' END
WHERE z.codigo IN ('ZN-LOS-CHILLOS', 'ZN-ORIENTE-01')
   OR z.nombre IN ('Los Chillos', 'Valle de Los Chillos');

-- Verificación: la zona debe contener ahora el centro de Sangolquí (-78.448, -0.332).
DO $$
DECLARE
  cubre BOOLEAN;
BEGIN
  SELECT bool_or(ST_Contains(geom, ST_SetSRID(ST_MakePoint(-78.448, -0.332), 4326)))
    INTO cubre
  FROM operations.zones
  WHERE codigo IN ('ZN-LOS-CHILLOS', 'ZN-ORIENTE-01')
     OR nombre IN ('Los Chillos', 'Valle de Los Chillos');

  IF cubre IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migración 062: la zona Los Chillos NO cubre Sangolquí tras el UPDATE. '
                    'Revisar que la zona exista con el código/nombre esperado.';
  END IF;

  RAISE NOTICE 'Migración 062 OK: Los Chillos ahora cubre Sangolquí.';
END $$;

COMMIT;
