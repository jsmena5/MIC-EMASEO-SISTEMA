-- ============================================================================
-- MIC-EMASEO SISTEMA
-- Esquema Inicial Completo — Version Final Consolidada
-- PostgreSQL 15+ con PostGIS
-- Trabajo de Integracion Curricular — ESPE
-- ============================================================================
-- Este archivo reemplaza los archivos 001 al 007 de migraciones.
-- Genera el esquema en su VERSION FINAL directamente, sin ALTER TABLE.
--
-- Orden de ejecucion:
--   1. Extensiones
--   2. Esquemas
--   3. ENUMs
--   4. Tablas (auth -> public -> operations -> incidents -> ai -> notifications)
--   5. Indices optimizados (consolidados desde 001 + 004 + 005 + 007)
--   6. Funciones auxiliares y triggers
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;       -- Soporte geoespacial (PostGIS)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- Generacion de UUIDs v4
CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- Funciones criptograficas (gen_salt, crypt)

-- ============================================================================
-- 2. ESQUEMAS
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS auth;          -- Identidad, credenciales y autenticacion
CREATE SCHEMA IF NOT EXISTS operations;    -- Zonas operativas, asignaciones, personal
CREATE SCHEMA IF NOT EXISTS incidents;     -- Incidencias, imagenes, historial de estados
CREATE SCHEMA IF NOT EXISTS ai;            -- Resultados del analisis de IA (YOLOv8/RT-DETR)
CREATE SCHEMA IF NOT EXISTS notifications; -- Notificaciones push/email a usuarios

-- ============================================================================
-- 3. TIPOS ENUMERADOS (ENUMs)
-- ============================================================================

-- Roles del sistema (RBAC)
CREATE TYPE auth.user_role AS ENUM (
    'CIUDADANO',
    'OPERARIO',
    'SUPERVISOR',
    'ADMIN'
);

-- Estado de la cuenta de usuario
CREATE TYPE auth.user_status AS ENUM (
    'ACTIVO',
    'INACTIVO',
    'SUSPENDIDO'
);

-- Estado del ciclo de vida de una incidencia
CREATE TYPE incidents.incident_status AS ENUM (
    'PENDIENTE',
    'EN_ATENCION',
    'RESUELTA',
    'RECHAZADA'
);

-- Nivel de prioridad derivado del analisis IA
CREATE TYPE incidents.priority_level AS ENUM (
    'BAJA',
    'MEDIA',
    'ALTA',
    'CRITICA'
);

-- Clasificacion del tipo de residuo detectado por IA
CREATE TYPE ai.waste_type AS ENUM (
    'DOMESTICO',
    'ORGANICO',
    'RECICLABLE',
    'ESCOMBROS',
    'PELIGROSO',
    'MIXTO',
    'OTRO'
);

-- Nivel de acumulacion estimado por IA
CREATE TYPE ai.accumulation_level AS ENUM (
    'BAJO',
    'MEDIO',
    'ALTO',
    'CRITICO'
);

-- Tipo de canal de notificacion
CREATE TYPE notifications.channel_type AS ENUM (
    'PUSH',
    'EMAIL'
);

-- Estado de la notificacion
CREATE TYPE notifications.notification_status AS ENUM (
    'PENDIENTE',
    'ENVIADA',
    'LEIDA',
    'FALLIDA'
);

-- ============================================================================
-- 4. TABLAS
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: auth
-- Tabla de identidad/credenciales pura.
-- Los datos de perfil (nombre, cedula, etc.) viven en public.ciudadanos
-- y operations.operarios segun el rol del usuario.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE auth.users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(150)     NOT NULL UNIQUE,
    username        VARCHAR(50)      NOT NULL UNIQUE,
    password_hash   VARCHAR(255)     NOT NULL,          -- Hash bcrypt — NUNCA texto plano
    rol             auth.user_role   NOT NULL DEFAULT 'CIUDADANO',
    estado          auth.user_status NOT NULL DEFAULT 'ACTIVO',
    is_verified     BOOLEAN          NOT NULL DEFAULT FALSE, -- TRUE cuando el ciudadano verifico su email
    ultimo_login    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  auth.users              IS 'Tabla de identidad y credenciales — solo datos de autenticacion. Perfiles en public.ciudadanos y operations.operarios';
COMMENT ON COLUMN auth.users.password_hash IS 'Hash bcrypt — nunca almacenar texto plano';
COMMENT ON COLUMN auth.users.is_verified   IS 'TRUE cuando el ciudadano completo la verificacion de email via OTP';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: public (tablas de perfil — separadas de las credenciales)
-- ────────────────────────────────────────────────────────────────────────────

-- Perfil del ciudadano (relacion 1:1 con auth.users, gestionado por app movil)
CREATE TABLE public.ciudadanos (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    apellido    VARCHAR(100) NOT NULL,
    cedula      VARCHAR(10)  NOT NULL UNIQUE,  -- Cedula ecuatoriana de 10 digitos
    telefono    VARCHAR(15),
    avatar_url  VARCHAR(500),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.ciudadanos         IS 'Perfil del ciudadano vinculado 1:1 con auth.users — gestionado por la app movil';
COMMENT ON COLUMN public.ciudadanos.user_id IS 'FK a auth.users(id) — tabla de identidad/credenciales';
COMMENT ON COLUMN public.ciudadanos.cedula  IS 'Cedula ecuatoriana de 10 digitos — UNIQUE en toda la tabla';

-- Tabla de registros pendientes (flujo de 3 pasos: datos → OTP → password)
-- Los datos viven aqui mientras el ciudadano completa el registro.
-- Al finalizar el paso 3, la fila se elimina y los datos pasan a auth.users + public.ciudadanos.
CREATE TABLE public.pending_registrations (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(100) NOT NULL,
    apellido        VARCHAR(100) NOT NULL,
    cedula          VARCHAR(10)  NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    otp_code        VARCHAR(6),
    otp_expires_at  TIMESTAMPTZ,
    is_verified     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pending_registrations IS 'Registros en proceso de verificacion — se eliminan al completar el registro';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: operations
-- ────────────────────────────────────────────────────────────────────────────

-- Perfil del personal operativo (roles: OPERARIO, SUPERVISOR, ADMIN)
-- zona_id es opcional: un ADMIN puede no tener zona asignada.
CREATE TABLE operations.operarios (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    apellido    VARCHAR(100) NOT NULL,
    cedula      VARCHAR(10)  NOT NULL UNIQUE,
    telefono    VARCHAR(15),
    zona_id     UUID,        -- FK a operations.zones — se define despues (forward reference)
    cargo       VARCHAR(100),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  operations.operarios         IS 'Perfil del personal operativo (OPERARIO/SUPERVISOR/ADMIN) — gestionado por el sistema web';
COMMENT ON COLUMN operations.operarios.user_id IS 'FK a auth.users(id) — tabla de identidad/credenciales';
COMMENT ON COLUMN operations.operarios.zona_id IS 'Zona operativa asignada (opcional para ADMIN)';
COMMENT ON COLUMN operations.operarios.cargo   IS 'Puesto laboral descriptivo, ej: "Supervisor Zona Norte"';

-- Zonas/sectores operativos con geometria poligonal
CREATE TABLE operations.zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(20)              NOT NULL UNIQUE,  -- Ej: "ZN-NORTE-01"
    nombre          VARCHAR(150)             NOT NULL,
    descripcion     TEXT,
    geom            GEOMETRY(Polygon, 4326)  NOT NULL,        -- Poligono — SRID 4326 (WGS84)
    supervisor_id   UUID                     REFERENCES auth.users(id) ON DELETE SET NULL,
    activa          BOOLEAN                  NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  operations.zones      IS 'Zonas/sectores operativos de EMASEO EP con geometria poligonal';
COMMENT ON COLUMN operations.zones.geom IS 'Poligono que delimita la zona — SRID 4326 (WGS84)';

-- FK diferida: operations.operarios → operations.zones (circular entre tablas del mismo schema)
ALTER TABLE operations.operarios
    ADD CONSTRAINT fk_operarios_zona
    FOREIGN KEY (zona_id) REFERENCES operations.zones(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: incidents
-- ────────────────────────────────────────────────────────────────────────────

-- Incidencias reportadas por ciudadanos
CREATE TABLE incidents.incidents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reportado_por   UUID                          NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    descripcion     TEXT,
    ubicacion       GEOMETRY(Point, 4326)         NOT NULL,   -- Coordenadas GPS del reporte
    direccion       VARCHAR(500),                              -- Direccion textual (geocodificacion inversa)
    estado          incidents.incident_status     NOT NULL DEFAULT 'PENDIENTE',
    prioridad       incidents.priority_level,                  -- Se llena tras analisis IA
    zona_id         UUID                          REFERENCES operations.zones(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),
    resuelto_at     TIMESTAMPTZ                              -- Timestamp de resolucion
);

COMMENT ON TABLE  incidents.incidents             IS 'Incidencias de acumulacion de residuos reportadas por ciudadanos';
COMMENT ON COLUMN incidents.incidents.ubicacion   IS 'Punto GPS del reporte — SRID 4326 (WGS84)';
COMMENT ON COLUMN incidents.incidents.zona_id     IS 'Zona operativa determinada automaticamente por ST_Covers (trigger)';

-- Imagenes asociadas a una incidencia (1:N)
CREATE TABLE incidents.incident_images (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID         NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    image_url       VARCHAR(500) NOT NULL,  -- URL/path en almacenamiento (S3, local, etc.)
    es_principal    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE incidents.incident_images IS 'Fotografias capturadas por el ciudadano al reportar';

-- Historial de cambios de estado (auditoria completa)
CREATE TABLE incidents.status_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID                          NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    estado_anterior incidents.incident_status     NOT NULL,
    estado_nuevo    incidents.incident_status     NOT NULL,
    cambiado_por    UUID                          NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    observaciones   TEXT,
    created_at      TIMESTAMPTZ                   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_status_change CHECK (estado_anterior <> estado_nuevo)
);

COMMENT ON TABLE incidents.status_history IS 'Auditoria de cada transicion de estado de una incidencia';

-- Asignaciones de incidencias a operarios
CREATE TABLE incidents.assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID        NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    operario_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    asignado_por    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    fecha_esperada  TIMESTAMPTZ,           -- Fecha limite de resolucion
    notas           TEXT,
    completada      BOOLEAN     NOT NULL DEFAULT FALSE,
    completada_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE incidents.assignments IS 'Asignacion de incidencias a operarios por parte de supervisores';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: ai
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE ai.analysis_results (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id          UUID                    NOT NULL UNIQUE REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    modelo_nombre        VARCHAR(100)            NOT NULL,  -- Ej: "yolov8n", "rt-detr-l"
    modelo_version       VARCHAR(50),                       -- Ej: "v1.2.0"
    tipo_residuo         ai.waste_type           NOT NULL,
    nivel_acumulacion    ai.accumulation_level   NOT NULL,
    volumen_estimado_m3  NUMERIC(6,2),                      -- Volumen en metros cubicos
    confianza            NUMERIC(4,3)            NOT NULL,  -- Score 0.000 a 1.000
    detecciones          JSONB                   NOT NULL DEFAULT '[]'::jsonb,  -- Bounding boxes + labels
    imagen_procesada_url VARCHAR(500),                       -- URL de imagen con detecciones dibujadas
    tiempo_inferencia_ms INTEGER,                            -- Tiempo de procesamiento en ms
    created_at           TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_confianza_range   CHECK (confianza >= 0 AND confianza <= 1),
    CONSTRAINT chk_volumen_positive  CHECK (volumen_estimado_m3 IS NULL OR volumen_estimado_m3 >= 0)
);

COMMENT ON TABLE  ai.analysis_results             IS 'Resultados del analisis IA (YOLOv8/RT-DETR) por incidencia — relacion 1:1';
COMMENT ON COLUMN ai.analysis_results.detecciones IS 'Array JSON de bounding boxes: [{class, confidence, bbox: [x1,y1,x2,y2]}]';
COMMENT ON COLUMN ai.analysis_results.confianza   IS 'Score general de confianza del modelo (0.000 a 1.000)';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: notifications
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE notifications.notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id  UUID                              NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    incident_id UUID                              REFERENCES incidents.incidents(id) ON DELETE SET NULL,
    titulo      VARCHAR(200)                      NOT NULL,
    mensaje     TEXT                              NOT NULL,
    canal       notifications.channel_type        NOT NULL DEFAULT 'PUSH',
    estado      notifications.notification_status NOT NULL DEFAULT 'PENDIENTE',
    leida_at    TIMESTAMPTZ,
    enviada_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ                       NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notifications.notifications IS 'Notificaciones enviadas a ciudadanos sobre cambios en sus incidencias';

-- ============================================================================
-- 5. INDICES OPTIMIZADOS (consolidados de 001 + 004 + 005 + 007)
-- ============================================================================

-- ── Indices espaciales PostGIS (GIST) ─────────────────────────────────────
-- Criticos para ST_Contains, ST_Covers y consultas de proximidad

CREATE INDEX idx_incidents_ubicacion_gist ON incidents.incidents    USING GIST (ubicacion);
CREATE INDEX idx_zones_geom_gist          ON operations.zones       USING GIST (geom);

-- ── auth.users ─────────────────────────────────────────────────────────────
-- NOTA: idx_users_email se omite intencionalmente — la constraint UNIQUE
--       ya crea un indice implicito equivalente (evita escritura doble).
CREATE INDEX idx_users_rol    ON auth.users (rol);
CREATE INDEX idx_users_estado ON auth.users (estado);

-- ── incidents.incidents ────────────────────────────────────────────────────
CREATE INDEX idx_incidents_estado          ON incidents.incidents (estado);
CREATE INDEX idx_incidents_prioridad       ON incidents.incidents (prioridad);
CREATE INDEX idx_incidents_estado_prioridad ON incidents.incidents (estado, prioridad);
CREATE INDEX idx_incidents_zona_id         ON incidents.incidents (zona_id);
CREATE INDEX idx_incidents_reportado_por   ON incidents.incidents (reportado_por);
CREATE INDEX idx_incidents_created_at      ON incidents.incidents (created_at DESC);

-- Cubre la consulta mas frecuente del ciudadano en app movil:
-- WHERE reportado_por = $1 AND estado = $2 ORDER BY created_at DESC
CREATE INDEX idx_incidents_owner_estado ON incidents.incidents (reportado_por, estado, created_at DESC);

-- ── incidents.incident_images ──────────────────────────────────────────────
CREATE INDEX idx_images_incident_id ON incidents.incident_images (incident_id);

-- ── incidents.status_history ───────────────────────────────────────────────
CREATE INDEX idx_status_history_incident ON incidents.status_history (incident_id);
CREATE INDEX idx_status_history_created  ON incidents.status_history (created_at DESC);

-- ── incidents.assignments ──────────────────────────────────────────────────
CREATE INDEX idx_assignments_incident   ON incidents.assignments (incident_id);
CREATE INDEX idx_assignments_operario   ON incidents.assignments (operario_id);
CREATE INDEX idx_assignments_completada ON incidents.assignments (completada) WHERE completada = FALSE;

-- Previene asignaciones duplicadas activas para el mismo operario en la misma incidencia.
-- Indice parcial: permite reasignaciones historicas (completada = TRUE).
CREATE UNIQUE INDEX uq_assignment_activa ON incidents.assignments (incident_id, operario_id)
    WHERE completada = FALSE;

-- ── ai.analysis_results ────────────────────────────────────────────────────
CREATE INDEX idx_ai_tipo_residuo      ON ai.analysis_results (tipo_residuo);
CREATE INDEX idx_ai_nivel_acumulacion ON ai.analysis_results (nivel_acumulacion);

-- GIN sobre JSONB — necesario para filtrar por clase detectada por IA:
-- WHERE detecciones @> '[{"class": "PLASTICO"}]'
CREATE INDEX idx_ai_detecciones_gin ON ai.analysis_results USING GIN (detecciones);

-- ── notifications.notifications ────────────────────────────────────────────
CREATE INDEX idx_notif_usuario    ON notifications.notifications (usuario_id);
CREATE INDEX idx_notif_incident   ON notifications.notifications (incident_id);
CREATE INDEX idx_notif_estado     ON notifications.notifications (estado);

-- Optimiza el badge de notificaciones no leidas en la app
CREATE INDEX idx_notif_no_leidas ON notifications.notifications (usuario_id, estado)
    WHERE estado IN ('PENDIENTE', 'ENVIADA');

-- Cubre la paginacion del historial de notificaciones:
-- WHERE usuario_id = $1 ORDER BY created_at DESC LIMIT 20
CREATE INDEX idx_notif_usuario_fecha ON notifications.notifications (usuario_id, created_at DESC);

-- ── public.ciudadanos ──────────────────────────────────────────────────────
-- Busqueda por cedula al verificar duplicados en pre-registro
CREATE INDEX idx_ciudadanos_cedula ON public.ciudadanos (cedula);

-- ── operations.operarios ───────────────────────────────────────────────────
CREATE INDEX idx_operarios_cedula ON operations.operarios (cedula);

-- Listar personal asignado a una zona
CREATE INDEX idx_operarios_zona ON operations.operarios (zona_id);

-- ── public.pending_registrations ───────────────────────────────────────────
-- Permite limpiar registros vencidos sin verificar (mantenimiento)
CREATE INDEX idx_pending_created_at ON public.pending_registrations (created_at);

-- ============================================================================
-- 6. FUNCIONES AUXILIARES Y TRIGGERS
-- ============================================================================

-- ── Funcion: updated_at automatico ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.fn_update_timestamp IS 'Actualiza updated_at al momento actual en cada UPDATE';

-- Aplicar trigger de updated_at a todas las tablas con esa columna
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_ciudadanos_updated_at
    BEFORE UPDATE ON public.ciudadanos
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_operarios_updated_at
    BEFORE UPDATE ON operations.operarios
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_zones_updated_at
    BEFORE UPDATE ON operations.zones
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incidents.incidents
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

CREATE TRIGGER trg_assignments_updated_at
    BEFORE UPDATE ON incidents.assignments
    FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

-- ── Funcion: Asignacion automatica de zona por ubicacion GPS ──────────────
-- Usa ST_Covers (mas robusto que ST_Contains en bordes de poligono).
-- Cuando dos zonas se superponen, asigna la mas especifica (menor area).
CREATE OR REPLACE FUNCTION incidents.fn_assign_zone()
RETURNS TRIGGER AS $$
BEGIN
    NEW.zona_id := (
        SELECT id
        FROM   operations.zones
        WHERE  activa = TRUE
          AND  ST_Covers(geom, NEW.ubicacion)
        ORDER BY ST_Area(geom) ASC   -- zona mas especifica (menor area) primero
        LIMIT 1
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION incidents.fn_assign_zone IS 'Asigna automaticamente la zona operativa mas especifica usando ST_Covers + ORDER BY ST_Area';

CREATE TRIGGER trg_auto_assign_zone
    BEFORE INSERT OR UPDATE OF ubicacion ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_assign_zone();
