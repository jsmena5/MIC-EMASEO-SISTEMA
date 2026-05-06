-- Tabla para almacenar tokens FCM/APNs de dispositivos móviles

CREATE TABLE IF NOT EXISTS auth.device_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token        TEXT NOT NULL UNIQUE,
    platform     VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    app_version  VARCHAR(20),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user
    ON auth.device_tokens(user_id);

COMMENT ON TABLE auth.device_tokens IS
    'Tokens FCM/APNs para envío de push notifications a dispositivos móviles';
