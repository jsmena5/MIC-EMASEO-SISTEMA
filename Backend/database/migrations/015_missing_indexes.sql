-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 015 — Índices faltantes identificados en auditoría de rendimiento
--
-- Problema: las siguientes queries hacen full table scan sin estos índices:
--   • verify-reset-otp  → WHERE otp_hash = $1
--   • cleanup de tokens → WHERE expires_at < NOW()
--   • "¿quién cambió qué?" → WHERE cambiado_por = $1
--   • asignaciones por supervisor → WHERE asignado_por = $1
--   • métricas globales / reportes → ORDER BY created_at DESC (sin filtro de usuario)
-- ─────────────────────────────────────────────────────────────────────────────

-- auth.password_reset_tokens
-- Lookup en verify-reset-otp y reset-password (SHA-256 del OTP)
CREATE INDEX IF NOT EXISTS idx_prt_otp_hash
    ON auth.password_reset_tokens (otp_hash);

-- Limpieza de tokens expirados en auth.cleanup_expired_reset_tokens()
CREATE INDEX IF NOT EXISTS idx_prt_expires_at
    ON auth.password_reset_tokens (expires_at);

-- incidents.status_history
-- "¿qué cambios hizo este usuario?" (auditoría por actor)
CREATE INDEX IF NOT EXISTS idx_sh_cambiado_por
    ON incidents.status_history (cambiado_por);

-- incidents.assignments
-- "¿qué asignaciones realizó este supervisor?"
CREATE INDEX IF NOT EXISTS idx_asg_asignado_por
    ON incidents.assignments (asignado_por);

-- notifications.notifications
-- Métricas globales y reportes paginados sin filtro de usuario
CREATE INDEX IF NOT EXISTS idx_notif_created_at
    ON notifications.notifications (created_at DESC);
