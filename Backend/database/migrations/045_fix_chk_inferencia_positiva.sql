-- El constraint chk_inferencia_positiva (migración 016) exigía
-- tiempo_inferencia_ms IS NULL OR > 0. Pero el ML devuelve 0 cuando rechaza
-- una imagen ANTES de la inferencia (p. ej. blur < umbral, rechazo CLIP),
-- y finalizeNegativeCase intentaba insertar 0 → violaba el constraint →
-- el incidente quedaba FALLIDO y el ciudadano veía "Error en el análisis".
--
-- Se relaja a >= 0: un tiempo de 0 ms es válido y significa "rechazo temprano
-- sin inferencia completa". El image-service además normaliza 0 → NULL.
-- Idempotente.

ALTER TABLE ai.analysis_results DROP CONSTRAINT IF EXISTS chk_inferencia_positiva;

ALTER TABLE ai.analysis_results
  ADD CONSTRAINT chk_inferencia_positiva
  CHECK (tiempo_inferencia_ms IS NULL OR tiempo_inferencia_ms >= 0);
