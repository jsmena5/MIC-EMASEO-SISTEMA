-- ============================================================================
-- Migración 029: columnas para tracking asíncrono de tareas Celery
-- ============================================================================
-- Propósito: evitar que el Circuit Breaker marque incidentes como FALLIDO cuando
-- el worker Celery aún está ejecutando la inferencia. El image-service ahora libera
-- el CB en cuanto recibe el task_id y delega el polling a recoverCeleryTasks(),
-- que puede ejecutarse tras un reinicio o en cada ciclo de 30 s.
--
-- Columnas:
--   celery_task_id  — ID de la tarea Celery. NULL hasta que el ML acepta el job.
--   pending_s3_key  — Clave S3 de la imagen subida antes del polling completo.
--                     Permite que recoverCeleryTasks() recupere la imagen sin
--                     re-subirla. Se pone a NULL cuando el incidente pasa a
--                     PENDIENTE (en finalizeIncident) o FALLIDO (limpieza).
-- ============================================================================

ALTER TABLE incidents.incidents
    ADD COLUMN IF NOT EXISTS celery_task_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pending_s3_key  VARCHAR(500);

COMMENT ON COLUMN incidents.incidents.celery_task_id IS
    'ID de la tarea Celery enviada al ML-service. NULL si la submisión no se completó. '
    'Usado por recoverCeleryTasks() para re-poll tras timeout del polling principal.';

COMMENT ON COLUMN incidents.incidents.pending_s3_key IS
    'Clave S3 de la imagen cargada antes de completar el análisis ML. '
    'Permite que recoverCeleryTasks() referencie la imagen sin re-subirla. '
    'Se limpia (NULL) tras moverla a incident_images o de eliminarla por fallo.';

-- Índice parcial: solo filas que recoverCeleryTasks() necesita iterar.
CREATE INDEX IF NOT EXISTS idx_incidents_celery_pending
    ON incidents.incidents (celery_task_id)
    WHERE celery_task_id IS NOT NULL AND estado = 'PROCESANDO';
