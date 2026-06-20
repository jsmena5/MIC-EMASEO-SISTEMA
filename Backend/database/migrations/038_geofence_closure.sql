-- ============================================================
-- Migración 038: Columnas de cierre con geocerca
-- Aplicar en: Supabase SQL Editor
-- ============================================================

-- Columnas de evidencia de cierre en incidents
ALTER TABLE incidents.incidents
  ADD COLUMN IF NOT EXISTS cierre_lat         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cierre_lon         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS cierre_foto_url    TEXT,
  ADD COLUMN IF NOT EXISTS cierre_distancia_m NUMERIC(8,2);

-- image_svc necesita leer la tolerancia de geocerca al validar el cierre
GRANT SELECT ON operations.config TO image_svc;
