-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 010
-- Agrega los estados del ciclo de vida asíncrono al enum incident_status.
--
-- PROCESANDO : la imagen fue recibida, el pipeline ML está en curso
-- FALLIDO    : el análisis terminó sin detectar residuos o con error
--
-- ADD VALUE no puede ejecutarse dentro de un bloque de transacción explícito.
-- ============================================================================

ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'PROCESANDO';
ALTER TYPE incidents.incident_status ADD VALUE IF NOT EXISTS 'FALLIDO';
