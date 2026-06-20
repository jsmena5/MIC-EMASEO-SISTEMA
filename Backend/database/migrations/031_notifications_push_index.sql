-- ============================================================================
-- 031_notifications_push_index.sql
-- Índice parcial para la consulta del push-worker:
--   SELECT ... FROM notifications.notifications
--   WHERE estado = 'PENDIENTE' AND canal = 'PUSH' [AND usuario_id = $1]
-- Sin este índice esa consulta hace seq scan sobre la tabla completa.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_notifications_push_pending
    ON notifications.notifications (usuario_id, created_at)
    WHERE estado = 'PENDIENTE' AND canal = 'PUSH';

COMMENT ON INDEX notifications.idx_notifications_push_pending IS
    'Índice parcial para el push-worker: cubre (usuario_id, created_at) en notificaciones PUSH pendientes';
