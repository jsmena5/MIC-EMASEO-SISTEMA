-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 055
-- Estandarización del ciclo de vida de incidencias
--
-- Problema:
--   9 estados con semántica solapada generaban confusión en app, panel supervisor
--   y panel admin. EN_REVISION era funcionalmente idéntico a PENDIENTE (ambos
--   requerían validación del supervisor). REVISADO era ambiguo (¿revisado = válido
--   o solo visto?). RECHAZADA era inconsistente con el género del sustantivo.
--
-- Cambios:
--   EN_REVISION → PENDIENTE   (merge: ambos significan "espera validación supervisor")
--   REVISADO    → VALIDO      (rename: deja claro que el supervisor confirmó el caso)
--   RECHAZADA   → RECHAZADO   (rename: coherencia gramatical con el modelo de dominio)
--
-- Resultado: 7 estados bien delimitados
--   PROCESANDO  — ML analizando la imagen (transitorio, automático)
--   PENDIENTE   — Espera validación del supervisor (entrante)
--   VALIDO      — Supervisor confirmó como caso real a atender
--   EN_ATENCION — Asignado a operario de campo
--   RESUELTA    — Caso cerrado exitosamente
--   RECHAZADO   — Supervisor rechazó manualmente
--   DESCARTADO  — ML o supervisor descartó (sin acción requerida)
--   FALLIDO     — Error técnico de transmisión o procesamiento (sin acción requerida)
--
-- Agrupaciones de display en el panel supervisor:
--   ENTRANTES   = PROCESANDO + PENDIENTE
--   VÁLIDOS     = VALIDO + EN_ATENCION + RESUELTA
--   RECHAZADOS  = RECHAZADO
--   DESCARTADOS = DESCARTADO + FALLIDO
--   REVISADOS   = total (todos excepto PROCESANDO)
--
-- NOTA: ADD VALUE no puede ejecutarse dentro de una transacción explícita en
-- PostgreSQL ≤ 11. Los ADD VALUE van fuera del bloque BEGIN..COMMIT.
-- ============================================================================

-- ── 1. Añadir nuevos valores al ENUM (fuera de transacción) ──────────────────

ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'VALIDO';
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'RECHAZADO';

-- ── 2. Migrar datos y reconstruir el tipo dentro de transacción ──────────────

BEGIN;

-- 2a. Migrar registros a los nuevos valores
UPDATE incidents.incidents SET estado = 'PENDIENTE' WHERE estado = 'EN_REVISION';
UPDATE incidents.incidents SET estado = 'VALIDO'    WHERE estado = 'REVISADO';
UPDATE incidents.incidents SET estado = 'RECHAZADO' WHERE estado = 'RECHAZADA';

-- 2b. Convertir la columna a TEXT para poder reemplazar el tipo ENUM
ALTER TABLE incidents.incidents ALTER COLUMN estado TYPE TEXT;

-- 2c. Eliminar el tipo antiguo y crear uno limpio sin los valores obsoletos
DROP TYPE incidents.incident_status;

CREATE TYPE incidents.incident_status AS ENUM (
    'PROCESANDO',
    'PENDIENTE',
    'VALIDO',
    'EN_ATENCION',
    'RESUELTA',
    'RECHAZADO',
    'DESCARTADO',
    'FALLIDO'
);

-- 2d. Restaurar el tipo en la columna
ALTER TABLE incidents.incidents
    ALTER COLUMN estado TYPE incidents.incident_status
    USING estado::incidents.incident_status;

-- 2e. Actualizar fn_notify_citizen: reflejar nuevos nombres de estado
CREATE OR REPLACE FUNCTION incidents.fn_notify_citizen()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    CASE NEW.estado
        WHEN 'PENDIENTE' THEN
            v_titulo  := 'Reporte recibido';
            v_mensaje := 'Tu reporte fue validado y está en espera de atención.';
        WHEN 'EN_ATENCION' THEN
            v_titulo  := 'Reporte en atención';
            v_mensaje := 'Un equipo operativo está atendiendo tu reporte.';
        WHEN 'RESUELTA' THEN
            v_titulo  := 'Reporte resuelto';
            v_mensaje := 'El equipo operativo resolvió el problema reportado.';
        WHEN 'RECHAZADO' THEN
            v_titulo  := 'Reporte rechazado';
            v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido.';
        WHEN 'DESCARTADO' THEN
            v_titulo  := 'Reporte descartado';
            v_mensaje := 'La imagen enviada no mostró acumulación de residuos detectable.';
        ELSE
            -- PROCESANDO, VALIDO, FALLIDO: sin notificación al ciudadano
            RETURN NEW;
    END CASE;

    INSERT INTO notifications.notifications
        (usuario_id, incident_id, incident_created_at, titulo, mensaje, canal)
    VALUES
        (NEW.reportado_por, NEW.id, NEW.created_at, v_titulo, v_mensaje, 'PUSH');

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING '[fn_notify_citizen] Error al insertar notificación: %', SQLERRM;
        RETURN NEW;
END;
$$;

COMMIT;
