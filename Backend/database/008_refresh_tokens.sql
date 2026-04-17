-- ============================================================================
-- MIC-EMASEO SISTEMA — Migración 008
-- Tabla de refresh tokens para rotación segura de sesiones
-- Se almacena el hash SHA-256 del token opaco, nunca el token en claro.
-- ============================================================================

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id          UUID        NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,   -- SHA-256 hex del token opaco de 64 bytes
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rt_token_hash ON auth.refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_rt_user_id    ON auth.refresh_tokens (user_id);

-- Función auxiliar para limpiar tokens expirados o revocados
-- Se puede llamar desde un cron job o pg_cron periódicamente
CREATE OR REPLACE FUNCTION auth.cleanup_expired_refresh_tokens()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM auth.refresh_tokens
  WHERE expires_at < now() OR revoked = TRUE;
$$;
