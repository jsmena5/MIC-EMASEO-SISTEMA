-- ============================================================================
-- 036 — Permisos lectura/escritura en notifications para image_svc
--
-- La migración 012 solo otorgó INSERT a image_svc.
-- El endpoint GET /api/incidents/notifications necesita SELECT.
-- El endpoint PUT /api/incidents/notifications/*/read necesita UPDATE.
-- ============================================================================

GRANT SELECT, UPDATE ON notifications.notifications TO image_svc;
