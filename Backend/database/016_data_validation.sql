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

-- ============================================================================
-- Constraints de validación de datos de dominio (D1–D5)
-- ============================================================================
-- D1: ciudadanos.cedula    → checksum módulo 10 del Registro Civil ecuatoriano
-- D2: ciudadanos.telefono  → formato ecuatoriano (+593... / 09...)
-- D3: incidents.ubicacion  → bounding box Ecuador continental + Galápagos
-- D4: analysis_results.tiempo_inferencia_ms → no puede ser negativo
-- D5: incidents.prioridad  → requerida salvo en PENDIENTE y RECHAZADA
--
-- NOTA D5: incidents.incident_status define 'PENDIENTE', 'EN_ATENCION',
-- 'RESUELTA', 'RECHAZADA'. Se permite NULL en PENDIENTE (IA aún no procesó)
-- y RECHAZADA (puede rechazarse antes del análisis IA).
-- ============================================================================

-- PostGIS requerida por D3 (ya activa en 01_init_schema.sql; idempotente)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ── D1: Función de validación de cédula ecuatoriana (algoritmo módulo 10) ───
CREATE OR REPLACE FUNCTION public.fn_validar_cedula_ec(p_cedula TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_coef    INT[] := ARRAY[2,1,2,1,2,1,2,1,2];
    v_suma    INT   := 0;
    v_d       INT;
    v_prod    INT;
    v_verif   INT;
BEGIN
    IF p_cedula !~ '^[0-9]{10}$' THEN RETURN FALSE; END IF;
    IF substring(p_cedula,1,2)::INT NOT BETWEEN 1 AND 24 THEN RETURN FALSE; END IF;
    FOR i IN 1..9 LOOP
        v_d    := substring(p_cedula, i, 1)::INT;
        v_prod := v_d * v_coef[i];
        IF v_prod >= 10 THEN v_prod := v_prod - 9; END IF;
        v_suma := v_suma + v_prod;
    END LOOP;
    v_verif := (10 - (v_suma % 10)) % 10;
    RETURN v_verif = substring(p_cedula, 10, 1)::INT;
END;
$$;

COMMENT ON FUNCTION public.fn_validar_cedula_ec IS
    'Valida cédula ecuatoriana de 10 dígitos según el algoritmo módulo 10 del Registro Civil. '
    'Verifica formato numérico, provincia válida (01–24) y dígito verificador.';

ALTER TABLE public.ciudadanos
    ADD CONSTRAINT chk_cedula_valida
    CHECK (public.fn_validar_cedula_ec(cedula));

-- ── D2: Formato teléfono ecuatoriano ────────────────────────────────────────
--   +5939XXXXXXXX  (E.164 internacional)  |  09XXXXXXXX  (local)
ALTER TABLE public.ciudadanos
    ADD CONSTRAINT chk_telefono_formato
    CHECK (
        telefono IS NULL
        OR telefono ~ '^\+?5939[0-9]{8}$|^09[0-9]{8}$'
    );

-- ── D3: Ubicación dentro del bounding box de Ecuador (continental + Galápagos)
--   Lon: -92.01 (W Galápagos) … -75.18 (E continental)
--   Lat:  -5.02 (S)           …   1.45 (N)
ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_ubicacion_ecuador
    CHECK (ST_Within(
        ubicacion,
        ST_MakeEnvelope(-92.01, -5.02, -75.18, 1.45, 4326)
    ));

-- ── D4: Tiempo de inferencia positivo ───────────────────────────────────────
ALTER TABLE ai.analysis_results
    ADD CONSTRAINT chk_inferencia_positiva
    CHECK (tiempo_inferencia_ms IS NULL OR tiempo_inferencia_ms > 0);

-- ── D5: Prioridad requerida cuando el estado implica análisis IA completado ─
ALTER TABLE incidents.incidents
    ADD CONSTRAINT chk_prioridad_requerida
    CHECK (
        prioridad IS NOT NULL
        OR estado IN ('PENDIENTE', 'RECHAZADA')
    );
