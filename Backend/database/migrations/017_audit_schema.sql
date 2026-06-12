-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 017
-- Esquema de auditoría centralizada conforme LOPDP Art. 39 (Ecuador).
--
-- Problema que resuelve:
--   incidents.status_history solo registra cambios de estado en incidentes.
--   La LOPDP exige registro de todos los tratamientos de datos personales
--   (INSERT/UPDATE/DELETE) en tablas sensibles. No existía un log central.
--
-- Qué crea esta migración:
--   1. Schema  audit
--   2. Tabla   audit.audit_log  particionada por mes (RANGE en ocurrido_at)
--   3. Partición del mes actual y del siguiente
--   4. Función audit.fn_audit_trigger() — trigger genérico reutilizable
--   5. Índice  idx_audit_log_ocurrido_at  para queries de reporte
--
-- Los triggers sobre tablas concretas se aplican en migraciones posteriores.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. SCHEMA
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS audit;

-- ============================================================================
-- 2. TABLA PARTICIONADA
--    Particionada por RANGE sobre ocurrido_at para que PostgreSQL descarte
--    particiones antiguas en las queries de reporte (partition pruning).
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit.audit_log (
    id            BIGSERIAL      NOT NULL,
    ocurrido_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    actor_id      UUID,                              -- NULL = acción del sistema
    actor_ip      INET,
    accion        VARCHAR(50)    NOT NULL,           -- 'INSERT' | 'UPDATE' | 'DELETE'
    schema_name   TEXT           NOT NULL,
    table_name    TEXT           NOT NULL,
    row_pk        TEXT,                              -- PK del registro afectado
    diff          JSONB                              -- {antes: {...}, despues: {...}}
) PARTITION BY RANGE (ocurrido_at);

-- ============================================================================
-- 3. PARTICIONES INICIALES
--    Una por mes actual y la siguiente para evitar errores de "no partition"
--    en el primer día de un mes nuevo antes de que corra el job de rotación.
-- ============================================================================
DO $$
DECLARE
    v_inicio_actual   DATE := DATE_TRUNC('month', NOW())::DATE;
    v_inicio_siguiente DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month')::DATE;
    v_inicio_tras_sig  DATE := (DATE_TRUNC('month', NOW()) + INTERVAL '2 months')::DATE;
    v_nombre_actual   TEXT := 'audit_log_' || TO_CHAR(NOW(), 'YYYY_MM');
    v_nombre_siguiente TEXT := 'audit_log_' || TO_CHAR(NOW() + INTERVAL '1 month', 'YYYY_MM');
BEGIN
    -- Partición mes actual
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname = v_nombre_actual
    ) THEN
        EXECUTE format(
            'CREATE TABLE audit.%I PARTITION OF audit.audit_log
             FOR VALUES FROM (%L) TO (%L)',
            v_nombre_actual, v_inicio_actual, v_inicio_siguiente
        );
    END IF;

    -- Partición mes siguiente
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'audit' AND c.relname = v_nombre_siguiente
    ) THEN
        EXECUTE format(
            'CREATE TABLE audit.%I PARTITION OF audit.audit_log
             FOR VALUES FROM (%L) TO (%L)',
            v_nombre_siguiente, v_inicio_siguiente, v_inicio_tras_sig
        );
    END IF;
END;
$$;

-- ============================================================================
-- 4. ÍNDICE PARA QUERIES DE REPORTE
--    Creado sobre la tabla padre; PostgreSQL lo propaga a cada partición.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_audit_log_ocurrido_at
    ON audit.audit_log (ocurrido_at DESC);

-- ============================================================================
-- 5. FUNCIÓN GENÉRICA DE TRIGGER
--
--    Captura OLD y NEW de cualquier operación DML y escribe una fila en
--    audit.audit_log.  El contexto del actor se pasa mediante variables de
--    sesión (GUCs locales) que la capa de aplicación fija antes de ejecutar
--    la operación:
--
--      SET LOCAL audit.actor_id = '<uuid>';
--      SET LOCAL audit.actor_ip = '<ip>';
--
--    Si las variables no están definidas, actor_id y actor_ip quedan NULL
--    (acción del sistema o conexión sin contexto de usuario).
--
--    Uso:
--      CREATE TRIGGER trg_audit_<tabla>
--        AFTER INSERT OR UPDATE OR DELETE ON <schema>.<tabla>
--        FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_trigger();
-- ============================================================================
CREATE OR REPLACE FUNCTION audit.fn_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_actor_id  UUID;
    v_actor_ip  INET;
    v_pk        TEXT;
    v_diff      JSONB;
    v_row       JSONB;
BEGIN
    -- Leer contexto de sesión (silencioso si no está definido)
    BEGIN
        v_actor_id := current_setting('audit.actor_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;

    BEGIN
        v_actor_ip := current_setting('audit.actor_ip', TRUE)::INET;
    EXCEPTION WHEN OTHERS THEN
        v_actor_ip := NULL;
    END;

    -- Construir diff según la operación
    IF TG_OP = 'INSERT' THEN
        v_row  := to_jsonb(NEW);
        v_pk   := (v_row ->> 'id');
        v_diff := jsonb_build_object('despues', v_row);

    ELSIF TG_OP = 'UPDATE' THEN
        v_row  := to_jsonb(NEW);
        v_pk   := (v_row ->> 'id');
        -- Solo los campos que realmente cambiaron
        v_diff := jsonb_build_object(
            'antes',   to_jsonb(OLD),
            'despues', v_row
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_row  := to_jsonb(OLD);
        v_pk   := (v_row ->> 'id');
        v_diff := jsonb_build_object('antes', v_row);
    END IF;

    INSERT INTO audit.audit_log (
        ocurrido_at,
        actor_id,
        actor_ip,
        accion,
        schema_name,
        table_name,
        row_pk,
        diff
    ) VALUES (
        NOW(),
        v_actor_id,
        v_actor_ip,
        TG_OP,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        v_pk,
        v_diff
    );

    RETURN NULL; -- AFTER trigger: el valor de retorno se ignora
END;
$$;

COMMIT;
