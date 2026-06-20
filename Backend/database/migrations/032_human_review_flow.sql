-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 032
-- Rediseño del flujo de revisión humana para reducir falsos negativos destructivos
--
-- Problema anterior:
--   FALLIDO cubría dos casos radicalmente distintos:
--     A. Error técnico real (ML caído, S3 falla, timeout)
--     B. Rechazo automático (has_waste=false, imagen correcta pero sin residuos)
--   En el caso B la imagen se ELIMINABA de S3, imposibilitando auditoría.
--
-- Nueva máquina de estados:
--   PROCESANDO → INCIDENTE_VALIDO    → PENDIENTE    (flujo normal con residuos)
--   PROCESANDO → RECHAZO_CONFIABLE   → DESCARTADO   (ML seguro: sin residuos, confianza ≥ umbral)
--   PROCESANDO → REVISION_REQUERIDA  → EN_REVISION  (ML dudoso: caso ambiguo → supervisor)
--   PROCESANDO → ERROR_TECNICO       → FALLIDO      (fallo técnico, imagen preservada si ya estaba en S3)
--   EN_REVISION → (supervisor)       → PENDIENTE    (supervisor valida el reporte)
--   EN_REVISION → (supervisor)       → RECHAZADA    (supervisor descarta el reporte)
--   DESCARTADO  → (supervisor)       → PENDIENTE    (supervisor anula rechazo automático)
--
-- Columnas nuevas en incidents.incidents:
--   decision_automatica   — tipo estructurado de decisión ML (enum de texto)
--   confianza_decision    — confianza del modelo en la decisión tomada
--   imagen_auditoria_url  — URL S3 de la imagen conservada para auditoría
--
-- ADD VALUE no puede ejecutarse dentro de un bloque de transacción explícito.
-- ============================================================================

-- ── 1. Nuevos valores en el enum de estados ───────────────────────────────────
--
-- EN_REVISION : imagen recibida, ML no fue concluyente → necesita revisión humana
-- DESCARTADO  : ML descartó con alta confianza (has_waste=false, confianza ≥ umbral)

ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'EN_REVISION';
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'DESCARTADO';

-- ── 2. Columnas de decisión estructurada en incidents.incidents ───────────────

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS decision_automatica  VARCHAR(30)
        CHECK (decision_automatica IN (
            'ERROR_TECNICO',       -- Fallo técnico: ML caído, S3, timeout
            'RECHAZO_CONFIABLE',   -- ML descartó con confianza ≥ umbral configurable
            'REVISION_REQUERIDA',  -- ML no fue concluyente → requiere revisión humana
            'INCIDENTE_VALIDO'     -- ML detectó residuos → se crea incidente
        )),
    ADD COLUMN IF NOT EXISTS confianza_decision   NUMERIC(4,3)
        CHECK (confianza_decision IS NULL
            OR (confianza_decision >= 0 AND confianza_decision <= 1)),
    ADD COLUMN IF NOT EXISTS imagen_auditoria_url VARCHAR(500);

COMMENT ON COLUMN incidents.incidents.decision_automatica IS
    'Tipo estructurado de la decisión automática del pipeline ML: '
    'ERROR_TECNICO | RECHAZO_CONFIABLE | REVISION_REQUERIDA | INCIDENTE_VALIDO. '
    'NULL cuando el incidente fue creado antes de esta migración.';

COMMENT ON COLUMN incidents.incidents.confianza_decision IS
    'Confianza del modelo ML en la decisión tomada (0.000 a 1.000). '
    'Permite distinguir rechazos seguros de casos ambiguos incluso post-facto.';

COMMENT ON COLUMN incidents.incidents.imagen_auditoria_url IS
    'URL S3 de la imagen del ciudadano conservada para auditoría. '
    'Presente en estados FALLIDO (si la imagen ya estaba en S3), DESCARTADO y EN_REVISION. '
    'Permite que el supervisor vea la imagen aunque la detección fuera negativa.';

-- ── 3. Columnas ai.analysis_results: permitir NULLs para casos negativos ──────
--
-- Antes: tipo_residuo y nivel_acumulacion eran NOT NULL.
-- Problema: en casos has_waste=false no hay clasificación de residuo ni nivel.
-- Los resultados parciales son igualmente valiosos para auditar la decisión del ML.

ALTER TABLE ai.analysis_results
    ALTER COLUMN tipo_residuo      DROP NOT NULL,
    ALTER COLUMN nivel_acumulacion DROP NOT NULL;

COMMENT ON COLUMN ai.analysis_results.tipo_residuo IS
    'Tipo de residuo detectado. NULL cuando has_waste=false (resultado negativo conservado para auditoría).';

COMMENT ON COLUMN ai.analysis_results.nivel_acumulacion IS
    'Nivel de acumulación estimado. NULL cuando has_waste=false (resultado negativo conservado para auditoría).';

-- ── 4. Índices para las nuevas columnas y estados ────────────────────────────

-- Permite filtrar/contar por tipo de decisión automática (dashboard de métricas)
CREATE INDEX IF NOT EXISTS idx_incidents_decision_automatica
    ON incidents.incidents (decision_automatica)
    WHERE decision_automatica IS NOT NULL;

-- Índice dedicado para la cola de revisión humana (hot path del panel supervisor)
CREATE INDEX IF NOT EXISTS idx_incidents_en_revision
    ON incidents.incidents (created_at DESC)
    WHERE estado = 'EN_REVISION';

-- Permite que el supervisor liste casos descartados para auditoría
CREATE INDEX IF NOT EXISTS idx_incidents_descartado
    ON incidents.incidents (created_at DESC)
    WHERE estado = 'DESCARTADO';

-- ── 5. Actualizar fn_notify_citizen para los nuevos estados ──────────────────
--
-- DESCARTADO: notificar al ciudadano que su imagen fue rechazada automáticamente.
-- EN_REVISION: sin notificación (estado interno del pipeline; el ciudadano será
--              notificado cuando el supervisor tome su decisión: PENDIENTE o RECHAZADA).

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
            WHEN 'DESCARTADO' THEN
                v_titulo  := 'Imagen sin residuos detectados';
                v_mensaje := 'El análisis automático no detectó acumulación de residuos en tu imagen. '
                             || 'Si crees que es un error, envía un nuevo reporte con una foto más clara y de mayor acercamiento.';
            -- EN_REVISION, PROCESANDO, FALLIDO: sin notificación al ciudadano.
            -- EN_REVISION: el ciudadano recibirá notificación cuando el supervisor decida (→ PENDIENTE o RECHAZADA).
            ELSE
                RETURN NEW;
        END CASE;

        INSERT INTO notifications.notifications
            (usuario_id, incident_id, titulo, mensaje, canal)
        VALUES
            (NEW.reportado_por, NEW.id, v_titulo, v_mensaje, 'PUSH');
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION incidents.fn_notify_citizen IS
    'Inserta una notificación PUSH al ciudadano en cada transición de estado visible. '
    'v2: agrega DESCARTADO (rechazo automático confiable). '
    'EN_REVISION no notifica al ciudadano; lo hará cuando el supervisor resuelva.';

-- ── 6. Retrocompatibilidad: marcar FALLIDO existentes como ERROR_TECNICO ──────
--
-- Los registros FALLIDO anteriores a esta migración no tienen decision_automatica.
-- Los marcamos como ERROR_TECNICO ya que su origen era técnico o desconocido.
-- Esto asegura que el filtro por decision_automatica funcione correctamente desde el primer día.

UPDATE incidents.incidents
SET decision_automatica = 'ERROR_TECNICO'
WHERE estado = 'FALLIDO'
  AND decision_automatica IS NULL;

-- ============================================================================
-- VERIFICACIÓN (ejecutar manualmente después de aplicar)
-- ============================================================================
-- -- Nuevos valores del enum:
-- SELECT enumlabel FROM pg_enum
--   JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
--   WHERE pg_type.typname = 'incident_status'
--   ORDER BY enumsortorder;
--
-- -- Nuevas columnas:
-- SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'incidents' AND table_name = 'incidents'
--     AND column_name IN ('decision_automatica', 'confianza_decision', 'imagen_auditoria_url');
--
-- -- NULLs permitidos en ai.analysis_results:
-- SELECT column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_schema = 'ai' AND table_name = 'analysis_results'
--     AND column_name IN ('tipo_residuo', 'nivel_acumulacion');
--
-- -- Trigger actualizado:
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'fn_notify_citizen';
-- ============================================================================
