-- ============================================================
-- Migración 039: Tabla de auditoría de imágenes para reentrenamiento
-- Aplicar en: Supabase SQL Editor
-- ============================================================

-- PostgreSQL no soporta CREATE TYPE IF NOT EXISTS — se usa un bloque DO idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'image_audit_label' AND n.nspname = 'ai'
  ) THEN
    CREATE TYPE ai.image_audit_label AS ENUM (
      'PENDIENTE',
      'VALIDA_ENTRENAMIENTO',
      'DUDOSA',
      'EXCLUIR'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS ai.image_audit (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     UUID        NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
  etiqueta        ai.image_audit_label NOT NULL DEFAULT 'PENDIENTE',
  comentario      TEXT,
  etiquetado_por  UUID        REFERENCES app_auth.users(id),
  etiquetado_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_audit_incident UNIQUE (incident_id)
);

CREATE INDEX IF NOT EXISTS idx_image_audit_etiqueta
  ON ai.image_audit (etiqueta);

CREATE INDEX IF NOT EXISTS idx_image_audit_incident
  ON ai.image_audit (incident_id);

GRANT SELECT, INSERT, UPDATE ON ai.image_audit TO image_svc;
