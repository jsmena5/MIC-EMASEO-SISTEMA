-- ============================================================================
-- Migración 03: Estados de ciclo de vida para procesamiento asíncrono
-- Agrega PROCESANDO y FALLIDO al ENUM incidents.incident_status para
-- soportar el patrón de polling en el endpoint POST /api/image/analyze.
--
--   PROCESANDO → el ML Service está analizando la imagen (estado inicial)
--   FALLIDO    → el análisis falló (servicio caído, timeout, sin residuos)
--
-- Orden de ejecución: después de 01_init_schema.sql y 02_seed_data.sql
-- ============================================================================

-- ALTER TYPE … ADD VALUE no puede ejecutarse dentro de una transacción en
-- PostgreSQL < 12. En PG 12+ se permite; si usas PG 11, corre cada ALTER
-- en su propia conexión sin BEGIN/COMMIT.
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'PROCESANDO' BEFORE 'PENDIENTE';
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'FALLIDO'     AFTER  'RECHAZADA';
