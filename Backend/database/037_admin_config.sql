-- ============================================================
-- Migración 037: Tabla de configuración del sistema (admin)
-- Aplicar en: Supabase SQL Editor
-- ============================================================

-- Tabla clave-valor para parámetros configurables por el admin.
CREATE TABLE IF NOT EXISTS operations.config (
  clave       VARCHAR(100) PRIMARY KEY,
  valor       TEXT         NOT NULL,
  descripcion TEXT,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Permisos para el servicio de usuarios
GRANT SELECT, INSERT, UPDATE ON operations.config TO users_svc;

-- Configuración inicial con valor por defecto
INSERT INTO operations.config (clave, valor, descripcion)
VALUES (
  'geofence_tolerancia_m',
  '10',
  'Radio máximo en metros para validar que el operario esté en el lugar al cerrar un reporte'
)
ON CONFLICT (clave) DO NOTHING;
