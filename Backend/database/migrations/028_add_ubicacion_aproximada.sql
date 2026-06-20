-- ============================================================================
-- Migración 028: Columna ubicacion_aproximada en incidents.incidents
-- ============================================================================
-- Propósito: identificar incidentes cuya ubicación GPS no pudo obtenerse y
-- se usaron coordenadas de referencia (centro de Quito). Estos incidentes se
-- excluyen del ruteo automático por zona y quedan en revisión manual.
--
-- Cambios:
--   1. Nueva columna ubicacion_aproximada BOOLEAN NOT NULL DEFAULT FALSE
--   2. Re-creación de fn_assign_zone para saltar la asignación cuando la
--      ubicación es aproximada (A-07).
-- ============================================================================

-- ── 1. Nueva columna ─────────────────────────────────────────────────────────

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS ubicacion_aproximada BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN incidents.incidents.ubicacion_aproximada IS
    'TRUE cuando las coordenadas son de referencia (GPS no disponible al reportar). '
    'El incidente queda sin zona asignada para revisión manual por supervisor.';

-- ── 2. Actualizar fn_assign_zone ──────────────────────────────────────────────
-- Incidentes con ubicacion_aproximada = TRUE se saltan la asignación automática
-- de zona: zona_id queda NULL y nota_fallo describe el motivo.

CREATE OR REPLACE FUNCTION incidents.fn_assign_zone()
RETURNS TRIGGER AS $$
DECLARE
    v_zona_id UUID;
BEGIN
    -- A-07: ubicación de referencia — no asignar zona; queda para revisión manual
    IF NEW.ubicacion_aproximada = TRUE THEN
        NEW.zona_id    := NULL;
        NEW.nota_fallo := 'Ubicación aproximada (GPS no disponible) — requiere revisión manual por supervisor';
        RETURN NEW;
    END IF;

    SELECT id
    INTO   v_zona_id
    FROM   operations.zones
    WHERE  activa = TRUE
      AND  ST_Covers(geom, NEW.ubicacion)
    ORDER BY ST_Area(geom) ASC   -- zona más específica (menor área) primero
    LIMIT 1;

    NEW.zona_id := v_zona_id;

    IF v_zona_id IS NULL THEN
        NEW.nota_fallo := 'Sin zona operativa cubre esta ubicación GPS';
        RAISE WARNING 'Incidente % sin zona asignada', NEW.id;
        PERFORM pg_notify('incidente_huerfano', NEW.id::TEXT);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION incidents.fn_assign_zone IS
    'Asigna automáticamente la zona operativa más específica usando ST_Covers + ORDER BY ST_Area. '
    'Si ubicacion_aproximada = TRUE, omite la asignación y marca para revisión manual. '
    'Si no hay zona que cubra la ubicación real, escribe nota_fallo y NOTIFY incidente_huerfano.';
