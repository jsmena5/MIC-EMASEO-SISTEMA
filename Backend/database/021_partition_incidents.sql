-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 021
-- Conversión de incidents.incidents a tabla particionada RANGE(created_at)
-- ============================================================================
-- CONTEXTO
-- --------
-- Con ~20k req/día y ~10% de incidentes nuevos ≈ 700k filas/año.
-- En 3 años superamos 2M filas sin particionar. Las queries del dashboard
-- supervisor (filtros estado + fecha) degradan sin partition pruning.
-- Aplicar sobre tabla vacía (pre-producción) es O(1); con millones de filas
-- requeriría pg_partman o una ventana de mantenimiento extensa.
--
-- RESTRICCIÓN DE POSTGRESQL (crítica)
-- ------------------------------------
-- Toda constraint UNIQUE/PRIMARY KEY sobre una tabla particionada DEBE incluir
-- todas las columnas de la clave de partición (PostgreSQL lanza:
-- "unique constraint on partitioned table must include all partitioning columns").
-- Como particionamos por RANGE(created_at), la PK cambia de (id) a (id, created_at).
--
-- IMPACTO EN TABLAS HIJO
-- ----------------------
-- Las FK que referencian incidents.incidents(id) se invalidan.
-- Solución: agregar incident_created_at a cada tabla hijo y declarar FK compuesta
--   (incident_id, incident_created_at) → incidents.incidents(id, created_at).
-- Los triggers fn_log_status_change y fn_notify_citizen (migración 011) también
-- se actualizan para proporcionar incident_created_at = NEW.created_at.
--
-- PRE-CONDICIÓN
-- -------------
-- Ambiente dev/staging con todas las tablas vacías.
-- Si incidents_old tiene filas (dev con datos de prueba), el PASO 9 las migra.
-- ============================================================================

BEGIN;

-- ============================================================================
-- PASO 1: Soltar FKs entrantes (tablas hijo → incidents.incidents)
-- ============================================================================
-- Los nombres son los auto-generados por PostgreSQL al definir las FK inline
-- en 01_init_schema.sql (formato: <tabla>_<columna>_fkey).
-- IF EXISTS garantiza idempotencia si ya se soltaron en un intento anterior.

ALTER TABLE incidents.incident_images
    DROP CONSTRAINT IF EXISTS incident_images_incident_id_fkey;

ALTER TABLE incidents.status_history
    DROP CONSTRAINT IF EXISTS status_history_incident_id_fkey;

ALTER TABLE incidents.assignments
    DROP CONSTRAINT IF EXISTS assignments_incident_id_fkey;

ALTER TABLE ai.analysis_results
    DROP CONSTRAINT IF EXISTS analysis_results_incident_id_fkey;

ALTER TABLE notifications.notifications
    DROP CONSTRAINT IF EXISTS notifications_incident_id_fkey;

-- ============================================================================
-- PASO 2: Renombrar tabla original (preserva datos si los hay en dev)
-- ============================================================================

ALTER TABLE incidents.incidents RENAME TO incidents_old;

-- ============================================================================
-- PASO 3: Crear tabla particionada principal
-- ============================================================================
-- PRIMARY KEY (id, created_at): id garantiza unicidad UUID global;
-- created_at satisface la exigencia de PostgreSQL de incluir la clave de
-- partición en toda constraint UNIQUE/PK de la tabla padre.
--
-- Las FK salientes (reportado_por, zona_id) se declaran en el padre y
-- PostgreSQL las hace cumplir en cada partición automáticamente.
-- La columna nota_fallo se incluye (agregada en migración 011).

CREATE TABLE incidents.incidents (
    id              UUID                          NOT NULL DEFAULT uuid_generate_v4(),
    reportado_por   UUID                          NOT NULL,
    descripcion     TEXT,
    ubicacion       GEOMETRY(Point, 4326)         NOT NULL,
    direccion       VARCHAR(500),
    estado          incidents.incident_status     NOT NULL DEFAULT 'PENDIENTE',
    prioridad       incidents.priority_level,
    zona_id         UUID,
    created_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    resuelto_at     TIMESTAMPTZ,
    nota_fallo      TEXT,

    PRIMARY KEY (id, created_at),

    CONSTRAINT fk_incidents_reportado_por
        FOREIGN KEY (reportado_por) REFERENCES auth.users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_incidents_zona_id
        FOREIGN KEY (zona_id) REFERENCES operations.zones(id) ON DELETE SET NULL
)
PARTITION BY RANGE (created_at);

COMMENT ON TABLE  incidents.incidents            IS 'Incidencias de acumulacion de residuos — particionada RANGE(created_at), una particion por mes';
COMMENT ON COLUMN incidents.incidents.ubicacion  IS 'Punto GPS del reporte — SRID 4326 (WGS84)';
COMMENT ON COLUMN incidents.incidents.zona_id    IS 'Zona operativa determinada automaticamente por ST_Covers (trigger fn_assign_zone)';
COMMENT ON COLUMN incidents.incidents.nota_fallo IS 'Razon de fallo: "ML no detecto residuos" o mensaje de error tecnico. NULL si el analisis tuvo exito.';

-- ============================================================================
-- PASO 4: Particiones mensuales
-- ============================================================================
-- El rango es [FROM, TO): el límite superior es EXCLUSIVO en PostgreSQL.
-- La partición _default actúa como catch-all para garantizar que ningún
-- INSERT falle por falta de partición durante el paso a producción.

-- ── 2025 ──────────────────────────────────────────────────────────────────
CREATE TABLE incidents.incidents_y2025m01 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE incidents.incidents_y2025m02 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE incidents.incidents_y2025m03 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE incidents.incidents_y2025m04 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE incidents.incidents_y2025m05 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE incidents.incidents_y2025m06 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE incidents.incidents_y2025m07 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE incidents.incidents_y2025m08 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE incidents.incidents_y2025m09 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE incidents.incidents_y2025m10 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE incidents.incidents_y2025m11 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE incidents.incidents_y2025m12 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- ── 2026 (hasta mes actual: mayo 2026) ────────────────────────────────────
CREATE TABLE incidents.incidents_y2026m01 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE incidents.incidents_y2026m02 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE incidents.incidents_y2026m03 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE incidents.incidents_y2026m04 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE incidents.incidents_y2026m05 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE incidents.incidents_y2026m06 PARTITION OF incidents.incidents
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Partición catch-all — filas con created_at fuera de todos los rangos anteriores.
CREATE TABLE incidents.incidents_default PARTITION OF incidents.incidents DEFAULT;

-- ============================================================================
-- PASO 5: Recrear índices en la tabla padre
-- ============================================================================
-- Los índices definidos en el padre se propagan automáticamente a TODAS las
-- particiones existentes y a las futuras que se creen con ATTACH PARTITION.

-- Espacial PostGIS (GIST) — ST_Covers, ST_Contains, consultas de proximidad
CREATE INDEX idx_incidents_ubicacion_gist
    ON incidents.incidents USING GIST (ubicacion);

-- Dashboard supervisor: filtros más frecuentes
CREATE INDEX idx_incidents_estado
    ON incidents.incidents (estado);
CREATE INDEX idx_incidents_prioridad
    ON incidents.incidents (prioridad);
CREATE INDEX idx_incidents_estado_prioridad
    ON incidents.incidents (estado, prioridad);

-- Lookups por relación
CREATE INDEX idx_incidents_zona_id
    ON incidents.incidents (zona_id);
CREATE INDEX idx_incidents_reportado_por
    ON incidents.incidents (reportado_por);

-- Paginación temporal
CREATE INDEX idx_incidents_created_at
    ON incidents.incidents (created_at DESC);

-- Query más frecuente del ciudadano en app móvil:
-- WHERE reportado_por = $1 AND estado = $2 ORDER BY created_at DESC
CREATE INDEX idx_incidents_owner_estado
    ON incidents.incidents (reportado_por, estado, created_at DESC);

-- ============================================================================
-- PASO 6: Recrear triggers en la tabla padre
-- ============================================================================
-- En PostgreSQL 13+ los triggers del padre se disparan automáticamente en todas
-- las particiones. Recreamos los cuatro triggers que tenía la tabla original.

CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_auto_assign_zone
    BEFORE INSERT OR UPDATE OF ubicacion ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_assign_zone();

-- Triggers de migración 011 — se referencian a las funciones que se actualizan
-- en el PASO 8 (el trigger llama a la función por nombre, no por cuerpo).
CREATE TRIGGER trg_log_status_change
    BEFORE UPDATE OF estado ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_log_status_change();

CREATE TRIGGER trg_notify_citizen
    AFTER UPDATE OF estado ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION incidents.fn_notify_citizen();

-- ============================================================================
-- PASO 7: Agregar incident_created_at a las tablas hijo
-- ============================================================================
-- La FK compuesta (incident_id, incident_created_at) permite a PostgreSQL
-- verificar la integridad referencial contra la tabla particionada.
-- La aplicación Node.js debe proporcionar incident_created_at al insertar
-- en estas tablas (se obtiene del campo created_at del incidente padre).
--
-- incident_images / status_history / assignments / analysis_results:
--   incident_id es NOT NULL → incident_created_at también NOT NULL.
--   Las tablas están vacías en pre-producción, por lo que la restricción NOT NULL
--   no requiere DEFAULT.
--
-- notifications.notifications:
--   incident_id es nullable (ON DELETE SET NULL) → incident_created_at también
--   nullable, con CHECK de coherencia para evitar (id NOT NULL, created_at NULL).

-- ── 7a. incidents.incident_images ─────────────────────────────────────────
ALTER TABLE incidents.incident_images
    ADD COLUMN IF NOT EXISTS incident_created_at TIMESTAMPTZ NOT NULL;

COMMENT ON COLUMN incidents.incident_images.incident_created_at IS
    'Replica de incidents.incidents.created_at — requerida para FK compuesta con tabla particionada';

ALTER TABLE incidents.incident_images
    ADD CONSTRAINT fk_images_incident
    FOREIGN KEY (incident_id, incident_created_at)
    REFERENCES incidents.incidents(id, created_at) ON DELETE CASCADE;

-- ── 7b. incidents.status_history ──────────────────────────────────────────
ALTER TABLE incidents.status_history
    ADD COLUMN IF NOT EXISTS incident_created_at TIMESTAMPTZ NOT NULL;

COMMENT ON COLUMN incidents.status_history.incident_created_at IS
    'Replica de incidents.incidents.created_at — requerida para FK compuesta con tabla particionada';

ALTER TABLE incidents.status_history
    ADD CONSTRAINT fk_status_history_incident
    FOREIGN KEY (incident_id, incident_created_at)
    REFERENCES incidents.incidents(id, created_at) ON DELETE CASCADE;

-- ── 7c. incidents.assignments ─────────────────────────────────────────────
ALTER TABLE incidents.assignments
    ADD COLUMN IF NOT EXISTS incident_created_at TIMESTAMPTZ NOT NULL;

COMMENT ON COLUMN incidents.assignments.incident_created_at IS
    'Replica de incidents.incidents.created_at — requerida para FK compuesta con tabla particionada';

ALTER TABLE incidents.assignments
    ADD CONSTRAINT fk_assignments_incident
    FOREIGN KEY (incident_id, incident_created_at)
    REFERENCES incidents.incidents(id, created_at) ON DELETE CASCADE;

-- ── 7d. ai.analysis_results ───────────────────────────────────────────────
ALTER TABLE ai.analysis_results
    ADD COLUMN IF NOT EXISTS incident_created_at TIMESTAMPTZ NOT NULL;

COMMENT ON COLUMN ai.analysis_results.incident_created_at IS
    'Replica de incidents.incidents.created_at — requerida para FK compuesta con tabla particionada';

ALTER TABLE ai.analysis_results
    ADD CONSTRAINT fk_analysis_incident
    FOREIGN KEY (incident_id, incident_created_at)
    REFERENCES incidents.incidents(id, created_at) ON DELETE CASCADE;

-- ── 7e. notifications.notifications ──────────────────────────────────────
-- FK nullable: cuando incident_id es NULL (notificación sin incidente asociado),
-- incident_created_at también debe ser NULL. El CHECK garantiza coherencia.
ALTER TABLE notifications.notifications
    ADD COLUMN IF NOT EXISTS incident_created_at TIMESTAMPTZ;

COMMENT ON COLUMN notifications.notifications.incident_created_at IS
    'Replica de incidents.incidents.created_at — requerida para FK compuesta con tabla particionada. NULL cuando incident_id es NULL.';

ALTER TABLE notifications.notifications
    ADD CONSTRAINT chk_notif_incident_coherence
    CHECK ((incident_id IS NULL) = (incident_created_at IS NULL));

ALTER TABLE notifications.notifications
    ADD CONSTRAINT fk_notif_incident
    FOREIGN KEY (incident_id, incident_created_at)
    REFERENCES incidents.incidents(id, created_at) ON DELETE SET NULL;

-- ============================================================================
-- PASO 8: Actualizar funciones de trigger que insertan en tablas hijo
-- ============================================================================
-- fn_log_status_change escribe en status_history → necesita incident_created_at.
-- fn_notify_citizen   escribe en notifications  → necesita incident_created_at.
-- Ambas proveen NEW.created_at, disponible porque los triggers corren en contexto
-- de la fila del incidente que se está actualizando.

CREATE OR REPLACE FUNCTION incidents.fn_log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_actor UUID;
    v_raw   TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN

        v_raw   := current_setting('app.current_user_id', true);
        v_actor := NULLIF(v_raw, '')::uuid;
        IF v_actor IS NULL THEN
            v_actor := '00000000-0000-0000-0000-000000000001'; -- usuario SISTEMA
        END IF;

        INSERT INTO incidents.status_history
            (incident_id, incident_created_at, estado_anterior, estado_nuevo, cambiado_por)
        VALUES
            (NEW.id, NEW.created_at, OLD.estado, NEW.estado, v_actor);

        IF NEW.estado = 'RESUELTA' THEN
            NEW.resuelto_at := NOW();
        END IF;

    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_log_status_change IS
    'Registra cada transicion de estado en status_history y setea resuelto_at al resolver. Actualizada en migración 021 para FK compuesta con tabla particionada.';

CREATE OR REPLACE FUNCTION incidents.fn_notify_citizen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        CASE NEW.estado
            WHEN 'PENDIENTE' THEN
                v_titulo  := 'Reporte aceptado';
                v_mensaje := 'Tu reporte fue validado. Prioridad asignada: '
                             || COALESCE(NEW.prioridad::text, 'por determinar') || '.';
            WHEN 'EN_ATENCION' THEN
                v_titulo  := 'Reporte en atención';
                v_mensaje := 'Un equipo de operarios está atendiendo el punto de acumulación de residuos que reportaste.';
            WHEN 'RESUELTA' THEN
                v_titulo  := '¡Reporte resuelto!';
                v_mensaje := 'El punto de acumulación de residuos fue limpiado. ¡Gracias por contribuir con tu ciudad!';
            WHEN 'RECHAZADA' THEN
                v_titulo  := 'Reporte rechazado';
                v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido en esta ocasión. Puedes enviar uno nuevo con más detalle.';
            ELSE
                RETURN NEW; -- PROCESANDO, FALLIDO: estados internos, sin notificación
        END CASE;

        INSERT INTO notifications.notifications
            (usuario_id, incident_id, incident_created_at, titulo, mensaje, canal)
        VALUES
            (NEW.reportado_por, NEW.id, NEW.created_at, v_titulo, v_mensaje, 'PUSH');
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_notify_citizen IS
    'Inserta una notificacion PUSH al ciudadano en cada transicion de estado visible. Actualizada en migración 021 para FK compuesta con tabla particionada.';

-- ============================================================================
-- PASO 9: Migrar datos desde incidents_old y eliminar tabla temporal
-- ============================================================================

DO $$
DECLARE
    v_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_count FROM incidents.incidents_old;

    IF v_count > 0 THEN
        RAISE NOTICE 'Migrando % filas desde incidents_old → incidents particionada...', v_count;

        INSERT INTO incidents.incidents
            (id, reportado_por, descripcion, ubicacion, direccion,
             estado, prioridad, zona_id, created_at, updated_at, resuelto_at, nota_fallo)
        SELECT
             id, reportado_por, descripcion, ubicacion, direccion,
             estado, prioridad, zona_id, created_at, updated_at, resuelto_at, nota_fallo
        FROM incidents.incidents_old;

        RAISE NOTICE 'Migración de datos completada. Eliminando incidents_old...';
        DROP TABLE incidents.incidents_old;
        RAISE NOTICE 'incidents_old eliminada exitosamente.';
    ELSE
        RAISE NOTICE 'incidents_old está vacía. Eliminando directamente...';
        DROP TABLE incidents.incidents_old;
        RAISE NOTICE 'incidents_old eliminada.';
    END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN (ejecutar manualmente)
-- ============================================================================
/*

-- 1. Confirmar que incidents.incidents es una tabla particionada (relkind = 'p'):
SELECT relname, relkind
FROM   pg_class
WHERE  relname = 'incidents'
  AND  relnamespace = 'incidents'::regnamespace::oid;

-- 2. Listar las 19 particiones creadas:
SELECT inhrelid::regclass AS particion
FROM   pg_inherits
WHERE  inhparent = 'incidents.incidents'::regclass
ORDER  BY 1;

-- 3. Verificar PK compuesta (id, created_at):
SELECT kcu.column_name, kcu.ordinal_position
FROM   information_schema.table_constraints      tc
JOIN   information_schema.key_column_usage       kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
WHERE  tc.table_schema    = 'incidents'
  AND  tc.table_name      = 'incidents'
  AND  tc.constraint_type = 'PRIMARY KEY'
ORDER  BY kcu.ordinal_position;
-- Debe devolver: id (1), created_at (2)

-- 4. Verificar FK compuestas en tablas hijo:
SELECT tc.table_schema, tc.table_name, tc.constraint_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS columnas
FROM   information_schema.table_constraints  tc
JOIN   information_schema.key_column_usage   kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema    = kcu.table_schema
WHERE  tc.constraint_type = 'FOREIGN KEY'
  AND  tc.constraint_name IN (
           'fk_images_incident', 'fk_status_history_incident',
           'fk_assignments_incident', 'fk_analysis_incident', 'fk_notif_incident'
       )
GROUP  BY 1, 2, 3
ORDER  BY 2;
-- Cada fila debe mostrar "incident_id, incident_created_at"

-- 5. Verificar partition pruning en query de dashboard supervisor:
EXPLAIN (ANALYZE false, COSTS true)
SELECT id, estado, prioridad, created_at
FROM   incidents.incidents
WHERE  estado     = 'PENDIENTE'
  AND  created_at >= '2026-01-01'
  AND  created_at <  '2026-04-01';
-- El plan debe mostrar solo incidents_y2026m01, m02 y m03.

-- 6. Verificar índices propagados a una partición de muestra:
SELECT indexname
FROM   pg_indexes
WHERE  schemaname = 'incidents'
  AND  tablename  = 'incidents_y2026m05'
ORDER  BY indexname;
-- Debe incluir los 8 índices definidos en el PASO 5.

*/
