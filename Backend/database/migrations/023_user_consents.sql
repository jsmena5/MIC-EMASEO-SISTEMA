CREATE TABLE IF NOT EXISTS auth.user_consents (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version_politica VARCHAR(20) NOT NULL,
    aceptada_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_origen        INET,
    user_agent       TEXT,
    revocada_at      TIMESTAMPTZ,
    UNIQUE (user_id, version_politica)
);

CREATE INDEX IF NOT EXISTS idx_consents_user
    ON auth.user_consents(user_id);

COMMENT ON TABLE auth.user_consents IS
    'Registro de consentimiento LOPDP por usuario y versión de política de privacidad';
