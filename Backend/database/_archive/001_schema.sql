-- ============================================================================
-- MIC-EMASEO SISTEMA
-- Esquema completo de Base de Datos — PostgreSQL 15+ con PostGIS
-- Trabajo de Integracion Curricular — ESPE
-- ============================================================================
-- Orden de ejecucion:
--   1. Extensiones
--   2. Esquemas
--   3. ENUMs
--   4. Tablas (auth -> operations -> incidents -> ai -> notifications)
--   5. Indices
--   6. Funciones auxiliares
-- ============================================================================

-- ============================================================================
-- 1. EXTENSIONES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS postgis;            -- Soporte geoespacial
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";        -- Generacion de UUIDs v4
CREATE EXTENSION IF NOT EXISTS pgcrypto;           -- Funciones criptograficas (gen_salt, crypt)

-- ============================================================================
-- 2. ESQUEMAS
-- ============================================================================
-- Separacion logica por dominio para mantener organizacion de microservicios
CREATE SCHEMA IF NOT EXISTS auth;          -- Usuarios, roles, autenticacion
CREATE SCHEMA IF NOT EXISTS operations;    -- Zonas operativas, asignaciones
CREATE SCHEMA IF NOT EXISTS incidents;     -- Incidencias, imagenes, historial
CREATE SCHEMA IF NOT EXISTS ai;            -- Resultados de analisis IA
CREATE SCHEMA IF NOT EXISTS notifications; -- Notificaciones a usuarios

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
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE auth.users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre          VARCHAR(100)        NOT NULL,
    apellido        VARCHAR(100)        NOT NULL,
    cedula          VARCHAR(10)         NOT NULL UNIQUE,
    email           VARCHAR(150)        NOT NULL UNIQUE,
    username        VARCHAR(50)         NOT NULL UNIQUE,
    password_hash   VARCHAR(255)        NOT NULL,  -- bcrypt hash, NUNCA texto plano
    telefono        VARCHAR(15),
    rol             auth.user_role      NOT NULL DEFAULT 'CIUDADANO',
    estado          auth.user_status    NOT NULL DEFAULT 'ACTIVO',
    avatar_url      VARCHAR(500),
    ultimo_login    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  auth.users IS 'Usuarios del sistema con RBAC';
COMMENT ON COLUMN auth.users.password_hash IS 'Hash bcrypt — nunca almacenar texto plano';
COMMENT ON COLUMN auth.users.cedula IS 'Cedula ecuatoriana de 10 digitos';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: operations
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE operations.zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo          VARCHAR(20)         NOT NULL UNIQUE,  -- Ej: "ZN-NORTE-01"
    nombre          VARCHAR(150)        NOT NULL,
    descripcion     TEXT,
    geom            GEOMETRY(Polygon, 4326) NOT NULL,     -- Poligono de la zona
    supervisor_id   UUID                REFERENCES auth.users(id) ON DELETE SET NULL,
    activa          BOOLEAN             NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  operations.zones IS 'Zonas/sectores operativos de EMASEO EP con geometria poligonal';
COMMENT ON COLUMN operations.zones.geom IS 'Poligono que delimita la zona — SRID 4326 (WGS84)';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: incidents
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE incidents.incidents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reportado_por   UUID                NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    descripcion     TEXT,
    ubicacion       GEOMETRY(Point, 4326) NOT NULL,       -- Coordenadas GPS del reporte
    direccion       VARCHAR(500),                          -- Direccion textual (geocodificacion inversa)
    estado          incidents.incident_status  NOT NULL DEFAULT 'PENDIENTE',
    prioridad       incidents.priority_level,              -- Se llena tras analisis IA
    zona_id         UUID                REFERENCES operations.zones(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    resuelto_at     TIMESTAMPTZ                            -- Timestamp de resolucion
);

COMMENT ON TABLE  incidents.incidents IS 'Incidencias de acumulacion de residuos reportadas por ciudadanos';
COMMENT ON COLUMN incidents.incidents.ubicacion IS 'Punto GPS del reporte — SRID 4326 (WGS84)';
COMMENT ON COLUMN incidents.incidents.zona_id IS 'Zona operativa determinada automaticamente por ST_Contains';

-- Imagenes asociadas a una incidencia (1 incidencia puede tener N imagenes)
CREATE TABLE incidents.incident_images (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID                NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    image_url       VARCHAR(500)        NOT NULL,  -- URL/path en almacenamiento (S3, local, etc.)
    es_principal    BOOLEAN             NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE incidents.incident_images IS 'Fotografias capturadas por el ciudadano al reportar';

-- Historial de cambios de estado (auditoria completa)
CREATE TABLE incidents.status_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID                NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    estado_anterior incidents.incident_status NOT NULL,
    estado_nuevo    incidents.incident_status NOT NULL,
    cambiado_por    UUID                NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    observaciones   TEXT,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    -- No permitir transiciones al mismo estado
    CONSTRAINT chk_status_change CHECK (estado_anterior <> estado_nuevo)
);

COMMENT ON TABLE incidents.status_history IS 'Auditoria de cada transicion de estado de una incidencia';

-- Asignaciones de incidencias a operarios
CREATE TABLE incidents.assignments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id     UUID                NOT NULL REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    operario_id     UUID                NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    asignado_por    UUID                NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    fecha_esperada  TIMESTAMPTZ,        -- Fecha limite esperada de resolucion
    notas           TEXT,
    completada      BOOLEAN             NOT NULL DEFAULT FALSE,
    completada_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE incidents.assignments IS 'Asignacion de incidencias a operarios por parte de supervisores';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: ai
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE ai.analysis_results (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_id         UUID                NOT NULL UNIQUE REFERENCES incidents.incidents(id) ON DELETE CASCADE,
    modelo_nombre       VARCHAR(100)        NOT NULL,  -- Ej: "yolov8n", "rt-detr-l"
    modelo_version      VARCHAR(50),                    -- Ej: "v1.2.0"
    tipo_residuo        ai.waste_type       NOT NULL,
    nivel_acumulacion   ai.accumulation_level NOT NULL,
    volumen_estimado_m3 NUMERIC(6,2),                  -- Volumen en metros cubicos
    confianza           NUMERIC(4,3)        NOT NULL,  -- Score 0.000 a 1.000
    detecciones         JSONB               NOT NULL DEFAULT '[]'::jsonb,  -- Bounding boxes + labels
    imagen_procesada_url VARCHAR(500),                  -- URL de imagen con detecciones dibujadas
    tiempo_inferencia_ms INTEGER,                       -- Tiempo de procesamiento en ms
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    -- La confianza debe estar entre 0 y 1
    CONSTRAINT chk_confianza_range CHECK (confianza >= 0 AND confianza <= 1),
    -- El volumen debe ser positivo
    CONSTRAINT chk_volumen_positive CHECK (volumen_estimado_m3 IS NULL OR volumen_estimado_m3 >= 0)
);

COMMENT ON TABLE  ai.analysis_results IS 'Resultados del analisis IA (YOLOv8/RT-DETR) por incidencia — relacion 1:1';
COMMENT ON COLUMN ai.analysis_results.detecciones IS 'Array JSON de bounding boxes: [{class, confidence, bbox: [x1,y1,x2,y2]}]';
COMMENT ON COLUMN ai.analysis_results.confianza IS 'Score general de confianza del modelo (0.000 a 1.000)';

-- ────────────────────────────────────────────────────────────────────────────
-- ESQUEMA: notifications
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE notifications.notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id      UUID                NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    incident_id     UUID                REFERENCES incidents.incidents(id) ON DELETE SET NULL,
    titulo          VARCHAR(200)        NOT NULL,
    mensaje         TEXT                NOT NULL,
    canal           notifications.channel_type    NOT NULL DEFAULT 'PUSH',
    estado          notifications.notification_status NOT NULL DEFAULT 'PENDIENTE',
    leida_at        TIMESTAMPTZ,
    enviada_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE notifications.notifications IS 'Notificaciones enviadas a ciudadanos sobre cambios en sus incidencias';

-- ============================================================================
-- 5. INDICES
-- ============================================================================

-- ── Indices espaciales (PostGIS GIST) ──────────────────────────────────────
-- Criticos para consultas de proximidad y contencion espacial

CREATE INDEX idx_incidents_ubicacion_gist
    ON incidents.incidents USING GIST (ubicacion);

CREATE INDEX idx_zones_geom_gist
    ON operations.zones USING GIST (geom);

-- ── Indices de busqueda frecuente ──────────────────────────────────────────

-- Usuarios
CREATE INDEX idx_users_rol        ON auth.users (rol);
CREATE INDEX idx_users_estado     ON auth.users (estado);
CREATE INDEX idx_users_email      ON auth.users (email);

-- Incidencias (filtros mas comunes del panel web)
CREATE INDEX idx_incidents_estado          ON incidents.incidents (estado);
CREATE INDEX idx_incidents_prioridad       ON incidents.incidents (prioridad);
CREATE INDEX idx_incidents_estado_prioridad ON incidents.incidents (estado, prioridad);
CREATE INDEX idx_incidents_zona_id         ON incidents.incidents (zona_id);
CREATE INDEX idx_incidents_reportado_por   ON incidents.incidents (reportado_por);
CREATE INDEX idx_incidents_created_at      ON incidents.incidents (created_at DESC);

-- Imagenes
CREATE INDEX idx_images_incident_id ON incidents.incident_images (incident_id);

-- Historial de estados
CREATE INDEX idx_status_history_incident ON incidents.status_history (incident_id);
CREATE INDEX idx_status_history_created  ON incidents.status_history (created_at DESC);

-- Asignaciones
CREATE INDEX idx_assignments_incident   ON incidents.assignments (incident_id);
CREATE INDEX idx_assignments_operario   ON incidents.assignments (operario_id);
CREATE INDEX idx_assignments_completada ON incidents.assignments (completada) WHERE completada = FALSE;

-- Analisis IA
CREATE INDEX idx_ai_tipo_residuo      ON ai.analysis_results (tipo_residuo);
CREATE INDEX idx_ai_nivel_acumulacion ON ai.analysis_results (nivel_acumulacion);

-- Notificaciones
CREATE INDEX idx_notif_usuario    ON notifications.notifications (usuario_id);
CREATE INDEX idx_notif_incident   ON notifications.notifications (incident_id);
CREATE INDEX idx_notif_estado     ON notifications.notifications (estado);
CREATE INDEX idx_notif_no_leidas  ON notifications.notifications (usuario_id, estado)
    WHERE estado IN ('PENDIENTE', 'ENVIADA');

-- ============================================================================
-- 6. FUNCIONES AUXILIARES
-- ============================================================================

-- Funcion: Asignar automaticamente la zona a una incidencia basado en su ubicacion
CREATE OR REPLACE FUNCTION incidents.fn_assign_zone()
RETURNS TRIGGER AS $$
BEGIN
    NEW.zona_id := (
        SELECT id FROM operations.zones
        WHERE activa = TRUE
          AND ST_Contains(geom, NEW.ubicacion)
        LIMIT 1
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_assign_zone
    BEFORE INSERT OR UPDATE OF ubicacion ON incidents.incidents
    FOR EACH ROW
    EXECUTE FUNCTION incidents.fn_assign_zone();

COMMENT ON FUNCTION incidents.fn_assign_zone IS 'Asigna automaticamente la zona operativa usando ST_Contains';

-- Funcion: Actualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger de updated_at a todas las tablas que lo necesitan
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON auth.users
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
