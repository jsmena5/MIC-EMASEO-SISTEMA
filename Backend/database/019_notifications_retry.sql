-- ============================================================================
-- Migración 019: Soporte de reintentos automáticos en notifications.notifications
-- ============================================================================
-- Agrega los campos necesarios para implementar un worker de reintentos con
-- backoff exponencial:
--   · intentos           — cuántas veces se ha intentado el envío
--   · ultimo_intento_at  — cuándo se realizó el último intento (diagnóstico)
--   · error_detalle      — mensaje de error del último fallo (diagnóstico)
--   · proximo_intento_at — cuándo debe ejecutarse el siguiente reintento
--
-- El índice parcial idx_notif_retry permite al worker seleccionar
-- eficientemente sólo las filas candidatas a reintento sin escanear
-- la tabla completa.
-- ============================================================================

ALTER TABLE notifications.notifications
    ADD COLUMN IF NOT EXISTS intentos           INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ultimo_intento_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS error_detalle      TEXT,
    ADD COLUMN IF NOT EXISTS proximo_intento_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notif_retry
    ON notifications.notifications (proximo_intento_at)
    WHERE estado = 'FALLIDA' AND intentos < 5;

COMMENT ON COLUMN notifications.notifications.intentos IS
    'Número de intentos de envío realizados';
COMMENT ON COLUMN notifications.notifications.ultimo_intento_at IS
    'Timestamp del último intento de envío; NULL si nunca se intentó';
COMMENT ON COLUMN notifications.notifications.error_detalle IS
    'Mensaje de error del último intento fallido; NULL si no hubo error';
COMMENT ON COLUMN notifications.notifications.proximo_intento_at IS
    'Timestamp del próximo reintento; NULL si no hay reintento programado';
