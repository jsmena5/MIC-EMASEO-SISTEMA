-- Migración 060: tabla junction supervisor_zones (1 supervisor → N zonas)
-- Los SUPERVISORES pasan a usar esta tabla en lugar de users.zona_id.
-- Los OPERARIOS conservan users.zona_id (1 zona por operario, sin cambios).
-- operations.zones.supervisor_id se mantiene como "supervisor principal" de la zona.

-- 1. Crear tabla junction
CREATE TABLE IF NOT EXISTS operations.supervisor_zones (
    supervisor_id UUID NOT NULL REFERENCES app_auth.users(id) ON DELETE CASCADE,
    zona_id       UUID NOT NULL REFERENCES operations.zones(id) ON DELETE CASCADE,
    asignado_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (supervisor_id, zona_id)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_zones_zona
    ON operations.supervisor_zones (zona_id);

-- 2. Migrar datos existentes: poblar junction desde users.zona_id (solo supervisores)
INSERT INTO operations.supervisor_zones (supervisor_id, zona_id)
SELECT id, zona_id
FROM app_auth.users
WHERE zona_id IS NOT NULL AND rol = 'SUPERVISOR'
ON CONFLICT DO NOTHING;

-- 3. Limpiar zona_id de supervisores (operarios conservan la suya)
UPDATE app_auth.users SET zona_id = NULL WHERE rol = 'SUPERVISOR';
