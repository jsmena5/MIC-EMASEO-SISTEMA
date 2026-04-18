-- ─────────────────────────────────────────────────────────────────────────────
-- Migración 009 — Tokens para recuperación de contraseña
--
-- Flujo:
--   1. forgot-password  → genera OTP, guarda SHA-256(otp) + expira en 15 min
--   2. verify-reset-otp → valida SHA-256(otp), devuelve 200 (pre-check UX)
--   3. reset-password   → valida SHA-256(otp) de nuevo, actualiza password_hash,
--                         marca token como used=TRUE (operación atómica)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  otp_hash   TEXT        NOT NULL,         -- SHA-256 del código OTP de 6 dígitos
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para buscar rápido por user_id (se usa en forgot-password para borrar tokens previos)
CREATE INDEX IF NOT EXISTS idx_prt_user_id
  ON auth.password_reset_tokens (user_id);

-- Función de limpieza: borra tokens expirados y usados (llamar desde un cron o manualmente)
CREATE OR REPLACE FUNCTION auth.cleanup_expired_reset_tokens()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM auth.password_reset_tokens
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$;
