-- ============================================================================
-- Migración 040 — Corrige FK de supervisado_por en ai.analysis_results
-- ============================================================================
--
-- Problema:
--   La migración 033 agregó la columna supervisado_por con:
--     REFERENCES auth.users(id)
--   En producción (Supabase) el schema personalizado es app_auth, no auth.
--   auth.users en Supabase apunta a la tabla interna de Supabase Auth, cuyos
--   UUIDs NO coinciden con los de app_auth.users. Consecuencia: el endpoint
--   PUT /api/incidents/:id/revision-ia falla con error de FK al guardar
--   la revisión del supervisor.
--
-- Solución:
--   1. Re-aplicar ADD COLUMN IF NOT EXISTS de migración 033 (idempotente)
--      por si no se aplicó o lo hizo con la FK incorrecta.
--   2. Reemplazar la FK de supervisado_por con la referencia correcta
--      a app_auth.users(id).
--
-- Nota sobre image_svc y app_auth.users:
--   image_svc no tiene SELECT en app_auth.users (REVOKE en migración 025).
--   Los queries de supervisor.controller.js que usaban JOIN a app_auth.users
--   fueron corregidos para devolver NULL en lugar de email/username del
--   supervisor. La FK aquí solo valida integridad al escribir, no al leer.
-- ============================================================================

-- ── 1. Asegurar que las columnas de migración 033 existen ────────────────────
-- Idempotente: ADD COLUMN IF NOT EXISTS no falla si la columna ya existe.
-- Esta vez sin FK en supervisado_por — la añadimos en el paso 2.

ALTER TABLE ai.analysis_results
    ADD COLUMN IF NOT EXISTS nivel_acumulacion_supervisor  ai.accumulation_level,
    ADD COLUMN IF NOT EXISTS tipo_residuo_supervisor       ai.waste_type,
    ADD COLUMN IF NOT EXISTS ia_fue_correcta               BOOLEAN,
    ADD COLUMN IF NOT EXISTS nota_supervision              TEXT,
    ADD COLUMN IF NOT EXISTS supervisado_at                TIMESTAMPTZ;

-- supervisado_por se trata aparte para manejar el FK correctamente
ALTER TABLE ai.analysis_results
    ADD COLUMN IF NOT EXISTS supervisado_por UUID;

-- ── 2. Corregir la FK de supervisado_por ─────────────────────────────────────
-- Quitar la FK incorrecta (si apunta a auth.users de Supabase) y agregar
-- la correcta a app_auth.users.

ALTER TABLE ai.analysis_results
    DROP CONSTRAINT IF EXISTS analysis_results_supervisado_por_fkey;

ALTER TABLE ai.analysis_results
    ADD CONSTRAINT analysis_results_supervisado_por_fkey
    FOREIGN KEY (supervisado_por)
    REFERENCES app_auth.users(id)
    ON DELETE SET NULL;

-- ── 3. Recrear índices de migración 033 (idempotentes) ───────────────────────

CREATE INDEX IF NOT EXISTS idx_ai_supervisado
    ON ai.analysis_results (supervisado_por, supervisado_at DESC)
    WHERE supervisado_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_ia_incorrecta
    ON ai.analysis_results (supervisado_at DESC)
    WHERE ia_fue_correcta = FALSE;

CREATE INDEX IF NOT EXISTS idx_ai_pendiente_revision
    ON ai.analysis_results (created_at DESC)
    WHERE supervisado_por IS NULL;

-- ── Verificación (ejecutar manualmente después de aplicar) ───────────────────
-- SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'ai' AND table_name = 'analysis_results'
--     AND column_name IN (
--       'ia_fue_correcta', 'supervisado_por', 'supervisado_at',
--       'nivel_acumulacion_supervisor', 'tipo_residuo_supervisor', 'nota_supervision'
--     );
--
-- SELECT conname, confrelid::regclass AS referenced_table
--   FROM pg_constraint
--   WHERE conrelid = 'ai.analysis_results'::regclass
--     AND conname = 'analysis_results_supervisado_por_fkey';
-- ============================================================================
