-- Validation constraints for text-length columns exposed to user input.
-- Prevents oversized payloads from saturating the database.

ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_descripcion_length
    CHECK (char_length(descripcion) <= 2000);

-- ── Columna para registrar fallos de asignación de zona ────────────────────
-- Cuando fn_assign_zone no encuentra zona operativa, escribe aquí la causa.
ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS nota_fallo TEXT;

COMMENT ON COLUMN incidents.incidents.nota_fallo IS
    'Mensaje de fallo cuando el trigger fn_assign_zone no puede asignar zona_id (ubicacion fuera de todas las zonas activas)';

-- ── fn_assign_zone actualizada: alerta en log + NOTIFY cuando no hay zona ──
CREATE OR REPLACE FUNCTION incidents.fn_assign_zone()
RETURNS TRIGGER AS $$
DECLARE
    v_zona_id UUID;
BEGIN
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
    'Asigna automaticamente la zona operativa mas especifica usando ST_Covers + ORDER BY ST_Area. '
    'Si no hay zona, escribe nota_fallo, emite WARNING al log y NOTIFY incidente_huerfano.';
