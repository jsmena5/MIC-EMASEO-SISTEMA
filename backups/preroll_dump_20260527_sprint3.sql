--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: ai; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA ai;


--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: incidents; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA incidents;


--
-- Name: notifications; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notifications;


--
-- Name: operations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA operations;


--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: accumulation_level; Type: TYPE; Schema: ai; Owner: -
--

CREATE TYPE ai.accumulation_level AS ENUM (
    'BAJO',
    'MEDIO',
    'ALTO',
    'CRITICO'
);


--
-- Name: waste_type; Type: TYPE; Schema: ai; Owner: -
--

CREATE TYPE ai.waste_type AS ENUM (
    'DOMESTICO',
    'ORGANICO',
    'RECICLABLE',
    'ESCOMBROS',
    'PELIGROSO',
    'MIXTO',
    'OTRO'
);


--
-- Name: user_role; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.user_role AS ENUM (
    'CIUDADANO',
    'OPERARIO',
    'SUPERVISOR',
    'ADMIN'
);


--
-- Name: user_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.user_status AS ENUM (
    'ACTIVO',
    'INACTIVO',
    'SUSPENDIDO'
);


--
-- Name: incident_status; Type: TYPE; Schema: incidents; Owner: -
--

CREATE TYPE incidents.incident_status AS ENUM (
    'PENDIENTE',
    'EN_ATENCION',
    'RESUELTA',
    'RECHAZADA',
    'PROCESANDO',
    'FALLIDO',
    'EN_REVISION',
    'DESCARTADO'
);


--
-- Name: priority_level; Type: TYPE; Schema: incidents; Owner: -
--

CREATE TYPE incidents.priority_level AS ENUM (
    'BAJA',
    'MEDIA',
    'ALTA',
    'CRITICA'
);


--
-- Name: channel_type; Type: TYPE; Schema: notifications; Owner: -
--

CREATE TYPE notifications.channel_type AS ENUM (
    'PUSH',
    'EMAIL'
);


--
-- Name: notification_status; Type: TYPE; Schema: notifications; Owner: -
--

CREATE TYPE notifications.notification_status AS ENUM (
    'PENDIENTE',
    'ENVIADA',
    'LEIDA',
    'FALLIDA'
);


--
-- Name: fn_touch_feedback_updated_at(); Type: FUNCTION; Schema: ai; Owner: -
--

CREATE FUNCTION ai.fn_touch_feedback_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: fn_audit_trigger(); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.fn_audit_trigger() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_actor_id  UUID;
    v_actor_ip  INET;
    v_pk        TEXT;
    v_diff      JSONB;
    v_row       JSONB;
BEGIN
    -- Leer contexto de sesión (silencioso si no está definido)
    BEGIN
        v_actor_id := current_setting('audit.actor_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_actor_id := NULL;
    END;

    BEGIN
        v_actor_ip := current_setting('audit.actor_ip', TRUE)::INET;
    EXCEPTION WHEN OTHERS THEN
        v_actor_ip := NULL;
    END;

    -- Construir diff según la operación
    IF TG_OP = 'INSERT' THEN
        v_row  := to_jsonb(NEW);
        v_pk   := (v_row ->> 'id');
        v_diff := jsonb_build_object('despues', v_row);

    ELSIF TG_OP = 'UPDATE' THEN
        v_row  := to_jsonb(NEW);
        v_pk   := (v_row ->> 'id');
        -- Solo los campos que realmente cambiaron
        v_diff := jsonb_build_object(
            'antes',   to_jsonb(OLD),
            'despues', v_row
        );

    ELSIF TG_OP = 'DELETE' THEN
        v_row  := to_jsonb(OLD);
        v_pk   := (v_row ->> 'id');
        v_diff := jsonb_build_object('antes', v_row);
    END IF;

    INSERT INTO audit.audit_log (
        ocurrido_at,
        actor_id,
        actor_ip,
        accion,
        schema_name,
        table_name,
        row_pk,
        diff
    ) VALUES (
        NOW(),
        v_actor_id,
        v_actor_ip,
        TG_OP,
        TG_TABLE_SCHEMA,
        TG_TABLE_NAME,
        v_pk,
        v_diff
    );

    RETURN NULL; -- AFTER trigger: el valor de retorno se ignora
END;
$$;


--
-- Name: cleanup_expired_refresh_tokens(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.cleanup_expired_refresh_tokens() RETURNS void
    LANGUAGE sql
    AS $$
  DELETE FROM auth.refresh_tokens
  WHERE expires_at < now() OR revoked = TRUE;
$$;


--
-- Name: cleanup_expired_reset_tokens(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.cleanup_expired_reset_tokens() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM auth.password_reset_tokens
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$;


--
-- Name: fn_assign_zone(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.fn_assign_zone() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_zona_id UUID;
BEGIN
    -- A-07: ubicaci??n de referencia ??? no asignar zona; queda para revisi??n manual
    IF NEW.ubicacion_aproximada = TRUE THEN
        NEW.zona_id    := NULL;
        NEW.nota_fallo := 'Ubicaci??n aproximada (GPS no disponible) ??? requiere revisi??n manual por supervisor';
        RETURN NEW;
    END IF;

    SELECT id
    INTO   v_zona_id
    FROM   operations.zones
    WHERE  activa = TRUE
      AND  ST_Covers(geom, NEW.ubicacion)
    ORDER BY ST_Area(geom) ASC   -- zona m??s espec??fica (menor ??rea) primero
    LIMIT 1;

    NEW.zona_id := v_zona_id;

    IF v_zona_id IS NULL THEN
        NEW.nota_fallo := 'Sin zona operativa cubre esta ubicaci??n GPS';
        RAISE WARNING 'Incidente % sin zona asignada', NEW.id;
        PERFORM pg_notify('incidente_huerfano', NEW.id::TEXT);
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_assign_zone(); Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON FUNCTION incidents.fn_assign_zone() IS 'Asigna autom??ticamente la zona operativa m??s espec??fica usando ST_Covers + ORDER BY ST_Area. Si ubicacion_aproximada = TRUE, omite la asignaci??n y marca para revisi??n manual. Si no hay zona que cubra la ubicaci??n real, escribe nota_fallo y NOTIFY incidente_huerfano.';


--
-- Name: fn_log_initial_status(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.fn_log_initial_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO incidents.status_history (
        incident_id,
        estado_anterior,
        estado_nuevo,
        cambiado_por,
        observaciones
    ) VALUES (
        NEW.id,
        NULL,
        NEW.estado,
        NEW.reportado_por,
        'Estado inicial al crear incidente'
    );
    RETURN NEW;
END;
$$;


--
-- Name: fn_log_status_change(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.fn_log_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_actor UUID;
    v_raw   TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN

        -- Leer actor de la variable de sesión; si no está seteada → SISTEMA
        v_raw   := current_setting('app.current_user_id', true);
        v_actor := NULLIF(v_raw, '')::uuid;
        IF v_actor IS NULL THEN
            v_actor := '00000000-0000-0000-0000-000000000001';
        END IF;

        INSERT INTO incidents.status_history
            (incident_id, estado_anterior, estado_nuevo, cambiado_por)
        VALUES
            (NEW.id, OLD.estado, NEW.estado, v_actor);

        -- Marcar timestamp de resolución cuando el incidente se cierra
        IF NEW.estado = 'RESUELTA' THEN
            NEW.resuelto_at := NOW();
        END IF;

    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_log_status_change(); Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON FUNCTION incidents.fn_log_status_change() IS 'Registra cada transición de estado en status_history y setea resuelto_at al resolver.';


--
-- Name: fn_notify_citizen(); Type: FUNCTION; Schema: incidents; Owner: -
--

CREATE FUNCTION incidents.fn_notify_citizen() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_titulo  TEXT;
    v_mensaje TEXT;
BEGIN
    IF OLD.estado IS DISTINCT FROM NEW.estado THEN
        CASE NEW.estado
            WHEN 'PENDIENTE' THEN
                v_titulo  := 'Reporte aceptado';
                v_mensaje := 'Tu reporte fue validado. Prioridad asignada: '
                             || COALESCE(NEW.prioridad::text, 'por determinar') || '.';
            WHEN 'EN_ATENCION' THEN
                v_titulo  := 'Reporte en atención';
                v_mensaje := 'Un equipo de operarios está atendiendo el punto de acumulación de residuos que reportaste.';
            WHEN 'RESUELTA' THEN
                v_titulo  := '¡Reporte resuelto!';
                v_mensaje := 'El punto de acumulación de residuos fue limpiado. ¡Gracias por contribuir con tu ciudad!';
            WHEN 'RECHAZADA' THEN
                v_titulo  := 'Reporte rechazado';
                v_mensaje := 'Tu reporte fue revisado y no pudo ser atendido en esta ocasión. Puedes enviar uno nuevo con más detalle.';
            WHEN 'DESCARTADO' THEN
                v_titulo  := 'Imagen sin residuos detectados';
                v_mensaje := 'El análisis automático no detectó acumulación de residuos en tu imagen. '
                             || 'Si crees que es un error, envía un nuevo reporte con una foto más clara y de mayor acercamiento.';
            -- EN_REVISION, PROCESANDO, FALLIDO: sin notificación al ciudadano.
            -- EN_REVISION: el ciudadano recibirá notificación cuando el supervisor decida (→ PENDIENTE o RECHAZADA).
            ELSE
                RETURN NEW;
        END CASE;

        INSERT INTO notifications.notifications
            (usuario_id, incident_id, titulo, mensaje, canal)
        VALUES
            (NEW.reportado_por, NEW.id, v_titulo, v_mensaje, 'PUSH');
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_notify_citizen(); Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON FUNCTION incidents.fn_notify_citizen() IS 'Inserta una notificación PUSH al ciudadano en cada transición de estado visible. v2: agrega DESCARTADO (rechazo automático confiable). EN_REVISION no notifica al ciudadano; lo hará cuando el supervisor resuelva.';


--
-- Name: fn_update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_update_timestamp(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_update_timestamp() IS 'Actualiza updated_at al momento actual en cada UPDATE';


--
-- Name: fn_validar_cedula_ec(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_cedula_ec(p_cedula text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
    v_coef    INT[] := ARRAY[2,1,2,1,2,1,2,1,2];
    v_suma    INT   := 0;
    v_d       INT;
    v_prod    INT;
    v_verif   INT;
BEGIN
    IF p_cedula !~ '^[0-9]{10}$' THEN RETURN FALSE; END IF;
    IF substring(p_cedula,1,2)::INT NOT BETWEEN 1 AND 24 THEN RETURN FALSE; END IF;
    FOR i IN 1..9 LOOP
        v_d    := substring(p_cedula, i, 1)::INT;
        v_prod := v_d * v_coef[i];
        IF v_prod >= 10 THEN v_prod := v_prod - 9; END IF;
        v_suma := v_suma + v_prod;
    END LOOP;
    v_verif := (10 - (v_suma % 10)) % 10;
    RETURN v_verif = substring(p_cedula, 10, 1)::INT;
END;
$_$;


--
-- Name: FUNCTION fn_validar_cedula_ec(p_cedula text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_cedula_ec(p_cedula text) IS 'Valida cédula ecuatoriana de 10 dígitos según el algoritmo módulo 10 del Registro Civil. Verifica formato numérico, provincia válida (01–24) y dígito verificador.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: analysis_feedback; Type: TABLE; Schema: ai; Owner: -
--

CREATE TABLE ai.analysis_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    analysis_result_id uuid NOT NULL,
    es_correcta boolean NOT NULL,
    comentario text,
    reportado_por uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE analysis_feedback; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON TABLE ai.analysis_feedback IS 'Feedback de operarios/supervisores sobre la precisi??n de los an??lisis IA. Base para detecci??n de drift y reentrenamiento del modelo.';


--
-- Name: COLUMN analysis_feedback.es_correcta; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_feedback.es_correcta IS 'TRUE = detecci??n correcta; FALSE = falso positivo o clasificaci??n err??nea.';


--
-- Name: COLUMN analysis_feedback.comentario; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_feedback.comentario IS 'Texto libre: tipo real de residuo observado, descripci??n del error, etc.';


--
-- Name: analysis_results; Type: TABLE; Schema: ai; Owner: -
--

CREATE TABLE ai.analysis_results (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    incident_id uuid NOT NULL,
    modelo_nombre character varying(100) NOT NULL,
    modelo_version character varying(50),
    tipo_residuo ai.waste_type,
    nivel_acumulacion ai.accumulation_level,
    volumen_estimado_m3 numeric(6,2),
    confianza numeric(4,3) NOT NULL,
    detecciones jsonb DEFAULT '[]'::jsonb NOT NULL,
    imagen_procesada_url character varying(500),
    tiempo_inferencia_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    nivel_acumulacion_supervisor ai.accumulation_level,
    tipo_residuo_supervisor ai.waste_type,
    ia_fue_correcta boolean,
    nota_supervision text,
    supervisado_por uuid,
    supervisado_at timestamp with time zone,
    incident_created_at timestamp with time zone,
    CONSTRAINT chk_confianza_range CHECK (((confianza >= (0)::numeric) AND (confianza <= (1)::numeric))),
    CONSTRAINT chk_inferencia_positiva CHECK (((tiempo_inferencia_ms IS NULL) OR (tiempo_inferencia_ms > 0))),
    CONSTRAINT chk_volumen_positive CHECK (((volumen_estimado_m3 IS NULL) OR (volumen_estimado_m3 >= (0)::numeric)))
);


--
-- Name: TABLE analysis_results; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON TABLE ai.analysis_results IS 'Resultados del analisis IA (YOLOv8/RT-DETR) por incidencia — relacion 1:1';


--
-- Name: COLUMN analysis_results.tipo_residuo; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.tipo_residuo IS 'Tipo de residuo detectado. NULL cuando has_waste=false (resultado negativo conservado para auditoría).';


--
-- Name: COLUMN analysis_results.nivel_acumulacion; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.nivel_acumulacion IS 'Nivel de acumulación estimado. NULL cuando has_waste=false (resultado negativo conservado para auditoría).';


--
-- Name: COLUMN analysis_results.confianza; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.confianza IS 'Score general de confianza del modelo (0.000 a 1.000)';


--
-- Name: COLUMN analysis_results.detecciones; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.detecciones IS 'Array JSON de bounding boxes: [{class, confidence, bbox: [x1,y1,x2,y2]}]';


--
-- Name: COLUMN analysis_results.nivel_acumulacion_supervisor; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.nivel_acumulacion_supervisor IS 'Nivel de acumulación real según el supervisor. NULL = no corregido. El valor original ML (nivel_acumulacion) NO se modifica — este campo es aditivo.';


--
-- Name: COLUMN analysis_results.tipo_residuo_supervisor; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.tipo_residuo_supervisor IS 'Tipo de residuo real según el supervisor. NULL = no corregido. El valor original ML (tipo_residuo) NO se modifica — este campo es aditivo.';


--
-- Name: COLUMN analysis_results.ia_fue_correcta; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.ia_fue_correcta IS 'Veredicto firmado del supervisor: TRUE = IA correcta, FALSE = IA incorrecta. NULL = no revisado todavía. Diferente de ai.analysis_feedback donde múltiples usuarios pueden opinar; aquí es la decisión oficial del supervisor.';


--
-- Name: COLUMN analysis_results.nota_supervision; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.nota_supervision IS 'Nota libre de auditoría del supervisor. Ejemplo: "Imagen muestra escombros "
    "de construcción, no domésticos. Nivel real es ALTO no MEDIO."';


--
-- Name: COLUMN analysis_results.supervisado_por; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.supervisado_por IS 'UUID del supervisor/admin que realizó la corrección. FK a auth.users.';


--
-- Name: COLUMN analysis_results.supervisado_at; Type: COMMENT; Schema: ai; Owner: -
--

COMMENT ON COLUMN ai.analysis_results.supervisado_at IS 'Timestamp de la última corrección supervisora. Permite ordenar las revisiones.';


--
-- Name: audit_log; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_log (
    id bigint NOT NULL,
    ocurrido_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_ip inet,
    accion character varying(50) NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    row_pk text,
    diff jsonb
)
PARTITION BY RANGE (ocurrido_at);


--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

CREATE SEQUENCE audit.audit_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: audit; Owner: -
--

ALTER SEQUENCE audit.audit_log_id_seq OWNED BY audit.audit_log.id;


--
-- Name: audit_log_2026_05; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_log_2026_05 (
    id bigint DEFAULT nextval('audit.audit_log_id_seq'::regclass) NOT NULL,
    ocurrido_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_ip inet,
    accion character varying(50) NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    row_pk text,
    diff jsonb
);


--
-- Name: audit_log_2026_06; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_log_2026_06 (
    id bigint DEFAULT nextval('audit.audit_log_id_seq'::regclass) NOT NULL,
    ocurrido_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    actor_ip inet,
    accion character varying(50) NOT NULL,
    schema_name text NOT NULL,
    table_name text NOT NULL,
    row_pk text,
    diff jsonb
);


--
-- Name: device_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.device_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform character varying(10) NOT NULL,
    app_version character varying(20),
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_tokens_platform_check CHECK (((platform)::text = ANY (ARRAY[('ios'::character varying)::text, ('android'::character varying)::text, ('web'::character varying)::text])))
);


--
-- Name: TABLE device_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.device_tokens IS 'Tokens FCM/APNs para envío de push notifications a dispositivos móviles';


--
-- Name: password_reset_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.password_reset_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    otp_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_registrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.pending_registrations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    nombre character varying(100) NOT NULL,
    apellido character varying(100) NOT NULL,
    cedula character varying(10) NOT NULL,
    email character varying(150) NOT NULL,
    otp_code character varying(64),
    otp_expires_at timestamp with time zone,
    is_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE pending_registrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.pending_registrations IS 'Registros en proceso de verificacion — se eliminan al completar el registro';


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(150) NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol auth.user_role DEFAULT 'CIUDADANO'::auth.user_role NOT NULL,
    estado auth.user_status DEFAULT 'ACTIVO'::auth.user_status NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    ultimo_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Tabla de identidad y credenciales — solo datos de autenticacion. Perfiles en public.ciudadanos y operations.operarios';


--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.password_hash IS 'Hash bcrypt — nunca almacenar texto plano';


--
-- Name: COLUMN users.is_verified; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_verified IS 'TRUE cuando el ciudadano completo la verificacion de email via OTP';


--
-- Name: assignments; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    incident_id uuid NOT NULL,
    operario_id uuid NOT NULL,
    asignado_por uuid NOT NULL,
    fecha_esperada timestamp with time zone,
    notas text,
    completada boolean DEFAULT false NOT NULL,
    completada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_created_at timestamp with time zone
);


--
-- Name: TABLE assignments; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.assignments IS 'Asignacion de incidencias a operarios por parte de supervisores';


--
-- Name: incident_images; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incident_images (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    incident_id uuid NOT NULL,
    image_url character varying(500) NOT NULL,
    es_principal boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_created_at timestamp with time zone
);


--
-- Name: TABLE incident_images; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.incident_images IS 'Fotografias capturadas por el ciudadano al reportar';


--
-- Name: incidents; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.incidents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reportado_por uuid NOT NULL,
    descripcion text,
    ubicacion public.geometry(Point,4326) NOT NULL,
    direccion character varying(500),
    estado incidents.incident_status DEFAULT 'PENDIENTE'::incidents.incident_status NOT NULL,
    prioridad incidents.priority_level,
    zona_id uuid,
    nota_fallo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    resuelto_at timestamp with time zone,
    ubicacion_aproximada boolean DEFAULT false NOT NULL,
    celery_task_id character varying(255),
    pending_s3_key character varying(500),
    decision_automatica character varying(30),
    confianza_decision numeric(4,3),
    imagen_auditoria_url character varying(500),
    CONSTRAINT chk_descripcion_length CHECK ((char_length(descripcion) <= 2000)),
    CONSTRAINT chk_prioridad_requerida CHECK (((prioridad IS NOT NULL) OR (estado = ANY (ARRAY['PENDIENTE'::incidents.incident_status, 'RECHAZADA'::incidents.incident_status, 'PROCESANDO'::incidents.incident_status, 'FALLIDO'::incidents.incident_status])))),
    CONSTRAINT chk_ubicacion_ecuador CHECK (public.st_within(ubicacion, public.st_makeenvelope(('-92.01'::numeric)::double precision, ('-5.02'::numeric)::double precision, ('-75.18'::numeric)::double precision, (1.45)::double precision, 4326))),
    CONSTRAINT incidents_confianza_decision_check CHECK (((confianza_decision IS NULL) OR ((confianza_decision >= (0)::numeric) AND (confianza_decision <= (1)::numeric)))),
    CONSTRAINT incidents_decision_automatica_check CHECK (((decision_automatica)::text = ANY (ARRAY[('ERROR_TECNICO'::character varying)::text, ('RECHAZO_CONFIABLE'::character varying)::text, ('REVISION_REQUERIDA'::character varying)::text, ('INCIDENTE_VALIDO'::character varying)::text])))
);


--
-- Name: TABLE incidents; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.incidents IS 'Incidencias de acumulacion de residuos reportadas por ciudadanos';


--
-- Name: COLUMN incidents.ubicacion; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.ubicacion IS 'Punto GPS del reporte — SRID 4326 (WGS84)';


--
-- Name: COLUMN incidents.zona_id; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.zona_id IS 'Zona operativa determinada automaticamente por ST_Covers (trigger)';


--
-- Name: COLUMN incidents.nota_fallo; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.nota_fallo IS 'Mensaje de fallo cuando el trigger fn_assign_zone no puede asignar zona_id (ubicacion fuera de todas las zonas activas)';


--
-- Name: COLUMN incidents.ubicacion_aproximada; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.ubicacion_aproximada IS 'TRUE cuando las coordenadas son de referencia (GPS no disponible al reportar). El incidente queda sin zona asignada para revisi??n manual por supervisor.';


--
-- Name: COLUMN incidents.celery_task_id; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.celery_task_id IS 'ID de la tarea Celery enviada al ML-service. NULL si la submisi??n no se complet??. Usado por recoverCeleryTasks() para re-poll tras timeout del polling principal.';


--
-- Name: COLUMN incidents.pending_s3_key; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.pending_s3_key IS 'Clave S3 de la imagen cargada antes de completar el an??lisis ML. Permite que recoverCeleryTasks() referencie la imagen sin re-subirla. Se limpia (NULL) tras moverla a incident_images o de eliminarla por fallo.';


--
-- Name: COLUMN incidents.decision_automatica; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.decision_automatica IS 'Tipo estructurado de la decisión automática del pipeline ML: ERROR_TECNICO | RECHAZO_CONFIABLE | REVISION_REQUERIDA | INCIDENTE_VALIDO. NULL cuando el incidente fue creado antes de esta migración.';


--
-- Name: COLUMN incidents.confianza_decision; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.confianza_decision IS 'Confianza del modelo ML en la decisión tomada (0.000 a 1.000). Permite distinguir rechazos seguros de casos ambiguos incluso post-facto.';


--
-- Name: COLUMN incidents.imagen_auditoria_url; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON COLUMN incidents.incidents.imagen_auditoria_url IS 'URL S3 de la imagen del ciudadano conservada para auditoría. Presente en estados FALLIDO (si la imagen ya estaba en S3), DESCARTADO y EN_REVISION. Permite que el supervisor vea la imagen aunque la detección fuera negativa.';


--
-- Name: status_history; Type: TABLE; Schema: incidents; Owner: -
--

CREATE TABLE incidents.status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    incident_id uuid NOT NULL,
    estado_anterior incidents.incident_status,
    estado_nuevo incidents.incident_status NOT NULL,
    cambiado_por uuid NOT NULL,
    observaciones text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_created_at timestamp with time zone,
    CONSTRAINT chk_status_change CHECK ((estado_anterior <> estado_nuevo))
);


--
-- Name: TABLE status_history; Type: COMMENT; Schema: incidents; Owner: -
--

COMMENT ON TABLE incidents.status_history IS 'Auditoria de cada transicion de estado de una incidencia';


--
-- Name: notifications; Type: TABLE; Schema: notifications; Owner: -
--

CREATE TABLE notifications.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    usuario_id uuid NOT NULL,
    incident_id uuid,
    titulo character varying(200) NOT NULL,
    mensaje text NOT NULL,
    canal notifications.channel_type DEFAULT 'PUSH'::notifications.channel_type NOT NULL,
    estado notifications.notification_status DEFAULT 'PENDIENTE'::notifications.notification_status NOT NULL,
    leida_at timestamp with time zone,
    enviada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    ultimo_intento_at timestamp with time zone,
    error_detalle text,
    proximo_intento_at timestamp with time zone,
    incident_created_at timestamp with time zone
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON TABLE notifications.notifications IS 'Notificaciones enviadas a ciudadanos sobre cambios en sus incidencias';


--
-- Name: COLUMN notifications.intentos; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON COLUMN notifications.notifications.intentos IS 'Número de intentos de envío realizados';


--
-- Name: COLUMN notifications.ultimo_intento_at; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON COLUMN notifications.notifications.ultimo_intento_at IS 'Timestamp del último intento de envío; NULL si nunca se intentó';


--
-- Name: COLUMN notifications.error_detalle; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON COLUMN notifications.notifications.error_detalle IS 'Mensaje de error del último intento fallido; NULL si no hubo error';


--
-- Name: COLUMN notifications.proximo_intento_at; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON COLUMN notifications.notifications.proximo_intento_at IS 'Timestamp del próximo reintento; NULL si no hay reintento programado';


--
-- Name: operarios; Type: TABLE; Schema: operations; Owner: -
--

CREATE TABLE operations.operarios (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    nombre character varying(100) NOT NULL,
    apellido character varying(100) NOT NULL,
    cedula character varying(10) NOT NULL,
    telefono character varying(15),
    zona_id uuid,
    cargo character varying(100),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE operarios; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON TABLE operations.operarios IS 'Perfil del personal operativo (OPERARIO/SUPERVISOR/ADMIN) — gestionado por el sistema web';


--
-- Name: COLUMN operarios.user_id; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON COLUMN operations.operarios.user_id IS 'FK a auth.users(id) — tabla de identidad/credenciales';


--
-- Name: COLUMN operarios.zona_id; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON COLUMN operations.operarios.zona_id IS 'Zona operativa asignada (opcional para ADMIN)';


--
-- Name: COLUMN operarios.cargo; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON COLUMN operations.operarios.cargo IS 'Puesto laboral descriptivo, ej: "Supervisor Zona Norte"';


--
-- Name: zones; Type: TABLE; Schema: operations; Owner: -
--

CREATE TABLE operations.zones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    codigo character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    geom public.geometry(Polygon,4326) NOT NULL,
    supervisor_id uuid,
    activa boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE zones; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON TABLE operations.zones IS 'Zonas/sectores operativos de EMASEO EP con geometria poligonal';


--
-- Name: COLUMN zones.geom; Type: COMMENT; Schema: operations; Owner: -
--

COMMENT ON COLUMN operations.zones.geom IS 'Poligono que delimita la zona — SRID 4326 (WGS84)';


--
-- Name: ciudadanos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ciudadanos (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    nombre character varying(100) NOT NULL,
    apellido character varying(100) NOT NULL,
    cedula character varying(10) NOT NULL,
    telefono character varying(15),
    avatar_url character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_cedula_valida CHECK (public.fn_validar_cedula_ec((cedula)::text)),
    CONSTRAINT chk_telefono_formato CHECK (((telefono IS NULL) OR ((telefono)::text ~ '^\+?5939[0-9]{8}$|^09[0-9]{8}$'::text)))
);


--
-- Name: TABLE ciudadanos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ciudadanos IS 'Perfil del ciudadano vinculado 1:1 con auth.users — gestionado por la app movil';


--
-- Name: COLUMN ciudadanos.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ciudadanos.user_id IS 'FK a auth.users(id) — tabla de identidad/credenciales';


--
-- Name: COLUMN ciudadanos.cedula; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ciudadanos.cedula IS 'Cedula ecuatoriana de 10 digitos — UNIQUE en toda la tabla';


--
-- Name: audit_log_2026_05; Type: TABLE ATTACH; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_log ATTACH PARTITION audit.audit_log_2026_05 FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');


--
-- Name: audit_log_2026_06; Type: TABLE ATTACH; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_log ATTACH PARTITION audit.audit_log_2026_06 FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');


--
-- Name: audit_log id; Type: DEFAULT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_log ALTER COLUMN id SET DEFAULT nextval('audit.audit_log_id_seq'::regclass);


--
-- Data for Name: analysis_feedback; Type: TABLE DATA; Schema: ai; Owner: -
--

COPY ai.analysis_feedback (id, analysis_result_id, es_correcta, comentario, reportado_por, created_at, updated_at) FROM stdin;
3e510a16-1b2e-410c-8ac0-9e98356d3d98	66a6e3ec-512e-416e-ab15-c2782ac9a4df	f	No es ningun desecho, es una forro de computadora.	a1000000-0000-0000-0000-000000000002	2026-05-27 00:23:52.853215+00	2026-05-27 00:24:03.601616+00
3aea3bf4-6b17-4fff-9990-e95f090a6831	b5f28769-5ab7-4502-aec1-56ff036b0767	f	Es solo un vaso, no es basura.	a1000000-0000-0000-0000-000000000002	2026-05-27 00:54:13.290252+00	2026-05-27 00:54:13.290252+00
\.


--
-- Data for Name: analysis_results; Type: TABLE DATA; Schema: ai; Owner: -
--

COPY ai.analysis_results (id, incident_id, modelo_nombre, modelo_version, tipo_residuo, nivel_acumulacion, volumen_estimado_m3, confianza, detecciones, imagen_procesada_url, tiempo_inferencia_ms, created_at, nivel_acumulacion_supervisor, tipo_residuo_supervisor, ia_fue_correcta, nota_supervision, supervisado_por, supervisado_at, incident_created_at) FROM stdin;
bccd09b8-4e93-4483-923b-a7346cf65222	2bc1fa03-94d7-4a40-9831-595283fa0e52	rtdetr_l_best.pt	\N	MIXTO	BAJO	0.15	0.827	[{"bbox": [1545, 780, 1663, 964], "class": "garbage", "confidence": 0.8945}, {"bbox": [650, 1076, 807, 1213], "class": "garbage", "confidence": 0.8948}, {"bbox": [763, 893, 989, 1026], "class": "garbage", "confidence": 0.6912}]	\N	3772	2026-05-26 21:50:46.392191+00	\N	\N	\N	\N	\N	\N	2026-05-26 21:50:37.656+00
66a6e3ec-512e-416e-ab15-c2782ac9a4df	d47514e0-d506-4f91-b2aa-1701ea66ece8	rtdetr_l_best.pt	\N	MIXTO	MEDIO	1.08	0.970	[{"bbox": [0, 1, 769, 746], "class": "garbage", "confidence": 0.9697}]	\N	7957	2026-05-27 00:21:34.368487+00	MEDIO	DOMESTICO	f	No es ningun desecho, es una forro de computadora.	a1000000-0000-0000-0000-000000000002	2026-05-27 00:24:03.601616+00	2026-05-27 00:21:17.399+00
b5f28769-5ab7-4502-aec1-56ff036b0767	7f43599b-e8cd-4476-8744-6a0679fb2f17	rtdetr_l_best.pt	\N	MIXTO	CRITICO	7.07	0.559	[{"bbox": [147, 100, 647, 690], "class": "garbage", "confidence": 0.932}, {"bbox": [267, 198, 333, 280], "class": "garbage", "confidence": 0.649}, {"bbox": [583, 604, 770, 769], "class": "garbage", "confidence": 0.4394}, {"bbox": [0, -1, 110, 758], "class": "garbage", "confidence": 0.3919}, {"bbox": [0, 2, 106, 666], "class": "garbage", "confidence": 0.3815}]	\N	8669	2026-05-26 21:42:58.862619+00	BAJO	RECICLABLE	f	Es solo un vaso, no es basura.	a1000000-0000-0000-0000-000000000002	2026-05-27 00:54:13.290252+00	2026-05-26 21:42:42.077+00
dad39f99-ec88-4dce-96ed-e30cad015a1e	38e73b2c-da8c-49ae-88bc-d4c7f2998975	rtdetr_l_best.pt	\N	MIXTO	MEDIO	10.49	0.860	[{"bbox": [166, 19, 770, 770], "class": "garbage", "confidence": 0.8598}]	\N	8847	2026-05-27 02:32:49.405046+00	\N	\N	\N	\N	\N	\N	2026-05-27 02:32:32.552+00
2fb494b4-5627-4d87-b4ab-d1140fb2ef04	06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	rtdetr_l_best.pt	\N	MIXTO	BAJO	0.13	0.699	[{"bbox": [368, 313, 487, 434], "class": "garbage", "confidence": 0.6988}]	\N	1864	2026-05-27 03:34:12.412221+00	\N	\N	\N	\N	\N	\N	2026-05-27 03:34:07.832+00
\.


--
-- Data for Name: audit_log_2026_05; Type: TABLE DATA; Schema: audit; Owner: -
--

COPY audit.audit_log_2026_05 (id, ocurrido_at, actor_id, actor_ip, accion, schema_name, table_name, row_pk, diff) FROM stdin;
\.


--
-- Data for Name: audit_log_2026_06; Type: TABLE DATA; Schema: audit; Owner: -
--

COPY audit.audit_log_2026_06 (id, ocurrido_at, actor_id, actor_ip, accion, schema_name, table_name, row_pk, diff) FROM stdin;
\.


--
-- Data for Name: device_tokens; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.device_tokens (id, user_id, token, platform, app_version, last_seen_at, created_at) FROM stdin;
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.password_reset_tokens (id, user_id, otp_hash, expires_at, used, created_at) FROM stdin;
de09d244-c05b-4e5e-9f9d-d3c80fb09d90	91fc74b5-df46-456f-9687-b8904dd37c7d	e75794da393624f308cefd689d90646e23420f0a40edc5fa5ce0fad3394fd456	2026-05-26 21:54:12.415+00	f	2026-05-26 21:39:12.416641+00
\.


--
-- Data for Name: pending_registrations; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.pending_registrations (id, nombre, apellido, cedula, email, otp_code, otp_expires_at, is_verified, created_at) FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at) FROM stdin;
2d5dd3bb-94b3-43dc-88c1-89939750af94	a1000000-0000-0000-0000-000000000002	5c1a368e60aa5cefd8e700e7d7f35afab28e0a70a34cb3008a0149bee0e37115	2026-06-01 19:34:23.785+00	t	2026-05-25 19:34:23.786699+00
7feb38d4-91ed-4b49-8118-e23d22e34313	a1000000-0000-0000-0000-000000000002	4ed8079d7d89b814c14a1ee7de34b23488a1d13860ff2fcff5aeac720921da2b	2026-06-01 19:48:24.204+00	t	2026-05-25 19:48:24.205222+00
56d324d1-37a9-42d2-b795-3a8df6d0c4bc	a1000000-0000-0000-0000-000000000002	4513f31b908818f4f8d519d3ff443fa9def1fb670c309eeccff36e2c5d7d495e	2026-06-01 20:03:22.756+00	t	2026-05-25 20:03:22.757087+00
213c55e7-fbcb-4b29-b17d-582c3c0ef555	a1000000-0000-0000-0000-000000000002	10198fc827c3d0e7d69736990a60b24a8e8dcda7c2a224df0be75de61308a0e4	2026-06-01 20:17:23.186+00	t	2026-05-25 20:17:23.187016+00
0cc92c91-4782-4331-880b-2269540a9a1d	a1000000-0000-0000-0000-000000000002	29b833e83c310047cf6500eb309a8f3952dcd8f5d4f54a87d4e48a9bd49e04a8	2026-06-01 20:31:23.641+00	t	2026-05-25 20:31:23.642225+00
4361530a-a4d3-4c14-bf6d-a6d5f510e35b	a1000000-0000-0000-0000-000000000002	a1c9b9c26207a3b0936ecb40951ee9b4ff4a402a1728138398d841991a32d5d7	2026-06-01 20:45:24.017+00	t	2026-05-25 20:45:24.01782+00
a2f19f02-8681-4da3-9cd2-549d98eca27d	a1000000-0000-0000-0000-000000000002	b70769c215e3fccad0a7a3299042460160e475ad284c403f3b06873f7e457d52	2026-06-01 21:00:22.58+00	t	2026-05-25 21:00:22.582007+00
77d29975-0e4b-4219-84cb-7ee58a7c39a6	a1000000-0000-0000-0000-000000000002	dd6550c4153e5f104dba9542966ee1e5c0ddda1cd2b41044de0ab45ff161728a	2026-06-01 21:14:23.101+00	t	2026-05-25 21:14:23.101337+00
8bc5e5ef-e1e0-4310-acd4-2983e1d7fea5	91fc74b5-df46-456f-9687-b8904dd37c7d	68f7ffdf7c53a805e4731a803daa777239da21217f0afc0d6791c211fe2487df	2026-05-27 22:22:30.898+00	t	2026-05-20 22:22:30.899055+00
c846562b-b50e-4c1e-a7fb-0f56bd5bc66a	91fc74b5-df46-456f-9687-b8904dd37c7d	40bdedffca1dee3ea4e72506453ada6a96ce1731824f56da6a941c28d24cc882	2026-05-27 23:18:49.726+00	t	2026-05-20 23:18:49.727455+00
1d3f9eba-ca0d-4bc4-b4f5-8e36ae3f19cd	91fc74b5-df46-456f-9687-b8904dd37c7d	c40f2a9077d972938493ea011f328c3844859ddaf401d95267ef0b727be5f254	2026-05-27 23:39:39.196+00	t	2026-05-20 23:39:39.197213+00
2d387185-f8bf-4534-b500-85f7adbc7440	91fc74b5-df46-456f-9687-b8904dd37c7d	160d81cc4fcf71dd3a950bf6a7543413fd5f94f649505ea2731ed92d1ea18903	2026-06-01 04:31:02.361+00	t	2026-05-25 04:31:02.362445+00
135d5e78-c00d-4a89-a825-e53ef9abc3aa	91fc74b5-df46-456f-9687-b8904dd37c7d	083cfadf27e97de1612a0a5780fdb07389def2fb5af15f7264369a4d190521fd	2026-06-01 04:35:44.54+00	t	2026-05-25 04:35:44.540597+00
5d50a191-4c3e-435e-a47c-e883a097fb37	91fc74b5-df46-456f-9687-b8904dd37c7d	fc89a55740f7b105cac3d6a4737c79aa6f9af9d305204e835c5bf646574a3cf5	2026-06-01 04:36:01.672+00	t	2026-05-25 04:36:01.672724+00
47e07860-7d5e-4c5a-a8dc-271ef967b01d	91fc74b5-df46-456f-9687-b8904dd37c7d	b2747dd35afd051c25a4aab1580962cadeecff0ab45ee55d066c850e5394af65	2026-06-01 11:59:24.785+00	t	2026-05-25 11:59:24.786349+00
f5f24f66-f49b-4a78-b640-51539727714f	91fc74b5-df46-456f-9687-b8904dd37c7d	2718e75402bf64f8c6d672c11e546683b700f3694205744713e5f2d6fb721118	2026-06-01 12:07:03.592+00	t	2026-05-25 12:07:03.593599+00
7d2fd3bd-b20f-4fba-b9e1-2800609ff856	91fc74b5-df46-456f-9687-b8904dd37c7d	eae54b52d8dc0072121e8668a250bedd9f2eddff5c0728d23b7cfc98982b7f5a	2026-06-01 16:14:13.514+00	t	2026-05-25 16:14:13.515902+00
befbeaed-3fa3-44e1-8eac-fc7ecbfbfb7f	91fc74b5-df46-456f-9687-b8904dd37c7d	129a84615015aa2d482349571f2e6bf93c40cee94fa7913fa1fe935818951283	2026-06-01 16:15:40.964+00	f	2026-05-25 16:15:40.965407+00
0d43d5b1-9b0f-49ff-ac07-4838f92941fc	a1000000-0000-0000-0000-000000000002	3dad184e86368c9f8b5ff73cc36bcc3de8716d2861c01da28fce53168a62f5fa	2026-06-01 18:35:57.477+00	f	2026-05-25 18:35:57.477762+00
9c596c9c-9507-4909-9cee-13461fb2c1bd	a1000000-0000-0000-0000-000000000002	edfc1430b35bbac5302218914930f345a362150f18e6352dbdb007c1a7c1f4b0	2026-06-01 18:36:07.856+00	f	2026-05-25 18:36:07.857278+00
2cf2a771-45f3-4b17-9249-3b0da68be0a0	a1000000-0000-0000-0000-000000000002	dc09b89198323e3a8b7de4d7e9fa6d5a7ad09f97a62ee8f628a55f7c4169a084	2026-06-01 18:36:21.303+00	t	2026-05-25 18:36:21.304297+00
b9c785ef-fcf4-461a-98cf-e1029865c2a7	a1000000-0000-0000-0000-000000000002	ccf81b45039ad0e7c912783fc83080dcc2c125389913a8d6bedca9ac6f3e95c5	2026-06-01 18:50:48.086+00	t	2026-05-25 18:50:48.086405+00
c33426c9-8e15-40b4-a59a-bde534ea00ba	a1000000-0000-0000-0000-000000000002	5167cd95f0b81d4e2e6dfac79277b4da5e43672f5f8acb1162bc80354a0bf18c	2026-06-01 19:17:07.158+00	f	2026-05-25 19:17:07.158913+00
ba4af613-1718-48f2-838d-75e36dc8366b	a1000000-0000-0000-0000-000000000002	318c12b7d06fa591baee5909cbc6245f81a3c9bfcf7b1855e9cd6b3d12f978fd	2026-06-01 19:05:32.184+00	t	2026-05-25 19:05:32.185598+00
f69a414c-8127-48f8-b346-b48e53886ebc	a1000000-0000-0000-0000-000000000002	f78dab643148c6d16f0d6788507574004c4c50b0ab7d7141e986c391e2bac9ee	2026-06-01 19:24:06.973+00	f	2026-05-25 19:24:06.973629+00
3bb3e979-759b-487e-9466-e1a0b24e5460	a1000000-0000-0000-0000-000000000002	2dea9bd1d8e7627c6ddfe8244bf74808f228512fb7a4d735e7606a2cff08a4a4	2026-06-01 19:24:06.974+00	f	2026-05-25 19:24:06.974513+00
4fe6817a-f3be-44db-a5cf-62002d9bd20c	a1000000-0000-0000-0000-000000000002	1c2202ecf0a184be3503c63986779d499789399470bfc2fc2897a800cfaa7089	2026-06-01 19:20:23.235+00	t	2026-05-25 19:20:23.235713+00
adf2cf45-5fd9-4685-bf7c-2d11ca0efd3c	a1000000-0000-0000-0000-000000000002	e2099f6a80b7ad97a5fb216ac724aa8b5a72a3fd594f140f9594778505b32183	2026-06-01 21:28:23.403+00	t	2026-05-25 21:28:23.403468+00
5937ed3a-458f-4690-a489-49959ac4fd81	a1000000-0000-0000-0000-000000000002	70ff10253ba759a1ab7c21260c42f486436f8857729829b3a80100953224d865	2026-06-01 21:42:23.867+00	t	2026-05-25 21:42:23.867803+00
06d74528-74de-4096-9031-af205c573830	a1000000-0000-0000-0000-000000000002	5e715830957ab49d22e9060c46014eb64db31712d11cda918562bb3856a4e95f	2026-06-01 21:56:24.271+00	t	2026-05-25 21:56:24.272065+00
d4d13003-5ee2-4481-b76f-ab7a1c70bb50	a1000000-0000-0000-0000-000000000002	2eec476f4ba0d2bfa1ff40fe7a69bc17d18f97d1d3490f063edd43cce9c8771a	2026-06-01 22:11:22.994+00	t	2026-05-25 22:11:22.994944+00
c5e88d18-1595-4a8e-bd2f-5ca530918e41	a1000000-0000-0000-0000-000000000002	d090cce47f79b4c8a88fcf2cb861a168d52feb62e81891cdcd5cf882c19cc409	2026-06-01 22:25:23.441+00	t	2026-05-25 22:25:23.441561+00
f268ed82-b498-4b15-af13-eefae4b56909	a1000000-0000-0000-0000-000000000002	51630e689932184dc0b03c2c2754cd158201a7c1c949827cb841f78710f7d141	2026-06-01 22:39:24.152+00	t	2026-05-25 22:39:24.152847+00
c8c2f836-6eb7-4190-8d9a-2f08029d34f1	a1000000-0000-0000-0000-000000000002	1d446907ad84b688c947df8fbe63a5e6f78d191093b06f2167cd21725102c7c6	2026-06-01 22:54:22.883+00	t	2026-05-25 22:54:22.883963+00
8c5693cd-9209-4b81-8888-f3d8b3d701e5	a1000000-0000-0000-0000-000000000002	97eda158b3376372884d8fc9a78a9dd84b081b70cac20cd7af388d6170b86f31	2026-06-01 23:08:23.443+00	t	2026-05-25 23:08:23.444778+00
f5c86171-5128-47df-8bbb-e1fb58f139f9	a1000000-0000-0000-0000-000000000002	e1e64b2826ab4c706c7145dc725878f4d222dc1e30ac049886ad18655a7bdb2c	2026-06-01 23:22:23.993+00	t	2026-05-25 23:22:23.994053+00
5077df0f-6097-419d-97f1-c51de6651a47	a1000000-0000-0000-0000-000000000002	07713e1827883071eca35c333d36568c47b63a15a2ad9510fdebf0af66111223	2026-06-01 23:36:24.392+00	t	2026-05-25 23:36:24.39311+00
c818d418-1ac0-4397-92de-e5892f8c152f	a1000000-0000-0000-0000-000000000002	585ecd3c0f6285031736ca1a076220963b322ccf28c2e1183387044109967e42	2026-06-01 23:51:23.034+00	t	2026-05-25 23:51:23.034296+00
4aa07d5b-8cb7-49ae-9b51-9cdd5de63c54	a1000000-0000-0000-0000-000000000002	204a61e6d4c7cba7cd2635d20ea1b26f4bc27a8a413aa7ab898fe598cd85608b	2026-06-02 00:05:23.425+00	t	2026-05-26 00:05:23.426693+00
fb6eaca0-bd5a-4adc-82ac-bd876654ce63	a1000000-0000-0000-0000-000000000002	c06d1db2de7510ebc28722b9746f509b1de234848791398099824d183918963a	2026-06-02 00:19:23.456+00	t	2026-05-26 00:19:23.45658+00
b721f74a-84a1-472b-b77e-ef0aff0f8203	a1000000-0000-0000-0000-000000000002	c01ee573ab3df3547e6f033d894db0cf5cdc5e3d68a672e9ea137fc3d46cb10a	2026-06-02 00:33:24.06+00	t	2026-05-26 00:33:24.060663+00
f8e06cd2-d472-41aa-acc0-ab46cca043b4	a1000000-0000-0000-0000-000000000002	85ad862c92372d0089b40dbfb69ed9a7d53a231f4a170388af4e171dd61a4b69	2026-06-02 00:48:22.606+00	t	2026-05-26 00:48:22.606557+00
04f6dd22-5bdb-4005-927b-24555b789f02	a1000000-0000-0000-0000-000000000002	e9283d7b9129bf5cd4d0ddf768611384fd1f11dc29cdcb75785828d9cc7a0154	2026-06-02 01:02:23.091+00	t	2026-05-26 01:02:23.091565+00
a208c228-5df8-448c-bdd6-52f7765abec7	a1000000-0000-0000-0000-000000000002	694f7f42c3b0e7554515dd5d31bb82f49d9b1a42447bfd831a55de776a02b1d2	2026-06-02 01:16:23.456+00	t	2026-05-26 01:16:23.456519+00
ab763c74-de31-4e94-930a-0cc90b43ab59	a1000000-0000-0000-0000-000000000002	1a279a0ce2b232bd668e63afe1ed4f2cc14b517ba934773a78258380e22f58d9	2026-06-02 01:30:24.006+00	t	2026-05-26 01:30:24.007011+00
83a1f54d-ac50-49cb-8d0b-1f7e8551aa2e	a1000000-0000-0000-0000-000000000002	01ddc55404a74e44c1555694fdfc842486ed52493b972c476154957fda6137e0	2026-06-02 01:45:22.565+00	t	2026-05-26 01:45:22.566132+00
184093b5-6202-443b-a722-bd36fd813dbd	a1000000-0000-0000-0000-000000000002	83a87246d70d7b3b11363399b8afa0cd2c203e57b33deaad570b102858a66a11	2026-06-02 01:59:22.855+00	t	2026-05-26 01:59:22.855844+00
e36df673-422b-42d2-850e-cbe45d10ad6a	a1000000-0000-0000-0000-000000000002	47e098da1e0ce62d3e9b8769bc078e9c528bb6ef935304e225415067be91b887	2026-06-02 02:13:22.376+00	t	2026-05-26 02:13:22.376434+00
8c27157e-48ca-4795-99d6-704d899bda09	a1000000-0000-0000-0000-000000000002	aa32f7d4647a5f458c781cd7d2ede642f7f42aac07c95625b40c348ed79432d7	2026-06-02 17:21:32.439+00	t	2026-05-26 17:21:32.439445+00
41459363-a17c-4f3b-af72-c975bb101b78	a1000000-0000-0000-0000-000000000002	d648fe00dcda8ded09461510d61c436ef8e23380bd641d6e53f8cbc41c799530	2026-06-02 21:31:22.006+00	t	2026-05-26 21:31:22.007077+00
6cca5835-61a1-4e94-a1dc-1d846b5e5e9d	91fc74b5-df46-456f-9687-b8904dd37c7d	83c6511d5a7c70fa2210001bb18037ff179b8c05f9df3ec542139c148afe0d4f	2026-06-02 21:40:16.444+00	f	2026-05-26 21:40:16.44478+00
3bb2aa72-b98e-437d-9e82-275d6efc36ea	a1000000-0000-0000-0000-000000000002	3662cb622f034f73d7ab09faf488401047926319a21f980ff42d8cdd462e1912	2026-06-02 23:30:45.03+00	f	2026-05-26 23:30:45.031064+00
45c95b55-cac6-4c9b-85e0-a7e9e9c41334	a1000000-0000-0000-0000-000000000002	4fb8d4f68a1f7147a1cffbe1281ef4d358c831ed1317c3f0847e990a11215050	2026-06-02 23:31:04.636+00	f	2026-05-26 23:31:04.636552+00
035ff725-1fcc-4641-b5d0-e224913bcdc1	a1000000-0000-0000-0000-000000000002	5320dfd62deb8cb83594c70f656e47bc6d7f8e40eb9e7d4f4563d7ed7b759508	2026-06-02 23:31:28.909+00	f	2026-05-26 23:31:28.91016+00
3234ebc9-7d69-47a8-bbaa-eb923c7a136a	a1000000-0000-0000-0000-000000000002	720865bcd6e3f06c24b101dee998c4d24b001cf4b4b5f5fe838373e7c4f6d7eb	2026-06-02 23:31:39.422+00	f	2026-05-26 23:31:39.422994+00
674ff19b-5c73-4aa2-997b-721a83e488e0	91fc74b5-df46-456f-9687-b8904dd37c7d	28873729f49247f16d7a090cffe68926fcb8f959b4e8b224a6abbdb67fadf3eb	2026-06-02 23:42:09.438+00	f	2026-05-26 23:42:09.438841+00
039155bf-1ab2-4125-b96c-2735428c4a00	91fc74b5-df46-456f-9687-b8904dd37c7d	cd9079223d281a8cb12bf3f85d7eea87f0ed256a273202509f5bf77b3214e893	2026-06-03 00:20:58.081+00	f	2026-05-27 00:20:58.081755+00
96c0a76d-9bdf-48eb-8904-72199c075c81	a1000000-0000-0000-0000-000000000002	5ce26635c7e9ac39f8e26c0561c7b99147c7643a759204ed989b61038cc02813	2026-06-02 21:47:16.833+00	t	2026-05-26 21:47:16.833688+00
d457390c-dd56-4982-886b-286919343e57	a1000000-0000-0000-0000-000000000002	4d8772bec4cd3f71abbd2e9f0f22595954088defe7438636ebd7643545fc3c5a	2026-06-03 00:22:47.421+00	t	2026-05-27 00:22:47.422321+00
4fe8d329-894e-4d26-bd9e-350edbb182a7	a1000000-0000-0000-0000-000000000002	87075931e606db3f31dd759aeb18ce0c226af43b4c87ac199debcc0ea6c4110b	2026-06-03 00:37:14.314+00	t	2026-05-27 00:37:14.315278+00
68ebc97c-8d0a-40ec-9047-80e8c0ca8070	91fc74b5-df46-456f-9687-b8904dd37c7d	bfbadc250e266650a2ff6bb7166203bd7e62c9d82c3cf279d9994fce78ea3622	2026-06-03 00:36:27.923+00	t	2026-05-27 00:36:27.924898+00
8e54f2e4-5361-4068-8088-2173ff98d979	91fc74b5-df46-456f-9687-b8904dd37c7d	57bdc176d83bdb62607c5caf04a1efa891b2de3e9ef2ac28d967e5149da5ed49	2026-06-03 00:53:26.028+00	f	2026-05-27 00:53:26.028785+00
386359bf-ebb9-4f14-8419-5845a998c280	a1000000-0000-0000-0000-000000000002	5f98b03594a921b7cb9fa7624e00c2ed8872f9c88a53b13d6159d7b4f35dc1f2	2026-06-03 00:51:14.354+00	t	2026-05-27 00:51:14.355292+00
e451c2cc-da04-4769-9cc4-f2aab885c2fe	a1000000-0000-0000-0000-000000000002	723b0e330c24193b59743aa418c5ea39b44af2764066f6e808f01fe46e931688	2026-06-03 01:05:14.275+00	t	2026-05-27 01:05:14.275452+00
9044fd00-9929-4c00-a248-ddd82e1fcdc0	a1000000-0000-0000-0000-000000000002	988bb72814f86bc2364010a68496bc673465e02dc5e566f9e2bb02a7f0766c89	2026-06-03 01:19:14.308+00	t	2026-05-27 01:19:14.309583+00
c7a18504-c057-49a7-b615-6cb66d58d761	a1000000-0000-0000-0000-000000000002	30be0e9e7ce0d4b5ee0a19cfd90aae3171614a8d10e991529533812d5160361f	2026-06-03 01:35:53.662+00	t	2026-05-27 01:35:53.663587+00
2d9d2dca-0b24-48a3-b262-dc58d5258eeb	91fc74b5-df46-456f-9687-b8904dd37c7d	d354ad86f842cf9d13f2a473a5fcfecfc38d951a12d0a04dc38ef16bdf0329b7	2026-06-03 02:31:49.516+00	f	2026-05-27 02:31:49.51715+00
63d209dc-0366-4b75-becb-fbdce80a4711	a1000000-0000-0000-0000-000000000002	4cd0a434d192cb0628e1179271b38f1a2e4ce416a9cd1a0be2d1c43f8ce7cb35	2026-06-03 02:25:12.024+00	t	2026-05-27 02:25:12.02531+00
05aed3ec-cde1-43f0-8179-982f6971f270	a1000000-0000-0000-0000-000000000002	2bf7a9dffd976c40bac0d7330731f95ee57d5fb7ca7639f680d3cad2210e496c	2026-06-03 02:39:14.299+00	t	2026-05-27 02:39:14.300579+00
fba98429-f08f-4937-b0a1-7b6b4cd696ff	a1000000-0000-0000-0000-000000000002	d7715a898ae7edc086ceb3a7a59fcb45a34f643d11dca10f120f78f1bde58308	2026-06-03 02:53:14.329+00	t	2026-05-27 02:53:14.330754+00
49194d1b-c877-41e7-85d0-4dc3eaaecb67	91fc74b5-df46-456f-9687-b8904dd37c7d	b59838a71a1fd791cab4e68185f63d9e779a316d5627c6d1110efb490f5bbec4	2026-06-03 03:18:03.932+00	t	2026-05-27 03:18:03.933176+00
9e59525d-006c-4ea1-8f07-b548dd906bc0	91fc74b5-df46-456f-9687-b8904dd37c7d	d4e6a96b5a85756a09cbe189d886e66ca612f13ba3f8516824325119ccb73510	2026-06-03 03:19:32.118+00	f	2026-05-27 03:19:32.118978+00
93a43262-4bda-46ff-a997-cce35f8e9455	a1000000-0000-0000-0000-000000000002	22a6bfdf8429a564399212920efbd48efdf4af423a2392c858a1f54753e43fc1	2026-06-03 03:07:14.648+00	t	2026-05-27 03:07:14.649285+00
b4e12bea-fd43-45b7-a268-fdfe319af3fd	a1000000-0000-0000-0000-000000000002	98b944eddf054faceecd2e26978b3e675683dba0c6d273872cb3bbab94cd96fe	2026-06-03 03:21:14.396+00	t	2026-05-27 03:21:14.39655+00
b6778ccd-9550-4014-bff5-e49374762af1	a1000000-0000-0000-0000-000000000002	5d10f8f527b32e1165b7315d620757f4e82259d13854776a03fad5aa71a9a5a4	2026-06-03 03:35:14.264+00	t	2026-05-27 03:35:14.264823+00
b22e599c-72b0-481c-a127-2bee2901e7f0	a1000000-0000-0000-0000-000000000002	e31bff2886010487d71d892a097858704ed63edb8cf9b8d347f1c68945d7e173	2026-06-03 03:49:14.262+00	t	2026-05-27 03:49:14.262981+00
25816ad8-03dd-4027-9ebf-28a2db898f9f	a1000000-0000-0000-0000-000000000002	57320ac56b9d780d7b950d836eb92428b372e457eeabefbcead91d7f1e5605a4	2026-06-03 04:03:17.254+00	f	2026-05-27 04:03:17.25504+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: -
--

COPY auth.users (id, email, username, password_hash, rol, estado, is_verified, ultimo_login, created_at, updated_at) FROM stdin;
00000000-0000-0000-0000-000000000001	sistema@emaseo.gob.ec	SISTEMA	$2a$10$oR3W2Q7lanSA7U69r4/mxernPS3Y.okl1xeRLj/ylFTV5AZ0e1hzS	ADMIN	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
a1000000-0000-0000-0000-000000000003	pedro.garcia@emaseo.gob.ec	p.garcia	$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy	OPERARIO	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
a1000000-0000-0000-0000-000000000004	luis.martinez@emaseo.gob.ec	l.martinez	$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy	OPERARIO	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
a1000000-0000-0000-0000-000000000005	ana.ciudadana@gmail.com	ana.c	$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy	CIUDADANO	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
a1000000-0000-0000-0000-000000000006	jorge.ramirez@gmail.com	jorge.r	$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36zQvU1YePlKbleIFlyQtGy	CIUDADANO	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
91fc74b5-df46-456f-9687-b8904dd37c7d	bryanfamiliat@gmail.com	bryanfamiliat	$2a$10$1/YADaIJRAwefi9bi76yx.b3asWV7XJNtti8z5ZLPx8XBRAOcRJc.	CIUDADANO	ACTIVO	t	\N	2026-05-20 22:19:15.610362+00	2026-05-25 16:15:40.965407+00
a1000000-0000-0000-0000-000000000001	admin@emaseo.gob.ec	admin	$2a$10$8jksQK7AQlzljO5uAERcuuvxxiZMiY7/wg22WumbA5XIWT1jdi1XO	ADMIN	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-25 18:32:59.282395+00
a1000000-0000-0000-0000-000000000002	maria.lopez@emaseo.gob.ec	m.lopez	$2a$10$z2yNtxd4bboApnoNdH8sf.SPIyAsbOg4WKOEttrnQxGZBT68lrG.S	SUPERVISOR	ACTIVO	t	\N	2026-05-20 21:11:33.255708+00	2026-05-25 18:32:59.282395+00
\.


--
-- Data for Name: assignments; Type: TABLE DATA; Schema: incidents; Owner: -
--

COPY incidents.assignments (id, incident_id, operario_id, asignado_por, fecha_esperada, notas, completada, completada_at, created_at, updated_at, incident_created_at) FROM stdin;
\.


--
-- Data for Name: incident_images; Type: TABLE DATA; Schema: incidents; Owner: -
--

COPY incidents.incident_images (id, incident_id, image_url, es_principal, created_at, incident_created_at) FROM stdin;
bac94a0e-77e1-4fda-b68f-c519e55282ef	7f43599b-e8cd-4476-8744-6a0679fb2f17	http://localhost:4000/api/media/emaseo-incidents/incidents/113bd1a9-324f-495c-ad14-714871d92410.jpg	t	2026-05-26 21:42:58.862619+00	2026-05-26 21:42:42.077+00
19a78e0c-0121-43dd-a147-1b3e08f664f0	2bc1fa03-94d7-4a40-9831-595283fa0e52	http://localhost:4000/api/media/emaseo-incidents/incidents/c3cb91d4-f2ca-4c8a-8b52-6933f83fc757.jpg	t	2026-05-26 21:50:46.392191+00	2026-05-26 21:50:37.656+00
ef9f321f-8fe9-4ede-b718-54cbaf94d427	d47514e0-d506-4f91-b2aa-1701ea66ece8	http://localhost:4000/api/media/emaseo-incidents/incidents/f67b8d47-dd68-4343-ab8e-a9b41db39189.jpg	t	2026-05-27 00:21:34.368487+00	2026-05-27 00:21:17.399+00
173e0d5a-aee4-43dd-b41a-e7c0112538d2	38e73b2c-da8c-49ae-88bc-d4c7f2998975	http://localhost:4000/api/media/emaseo-incidents/incidents/2012cb8a-fbab-4ceb-881f-c2e35e4bc2f9.jpg	t	2026-05-27 02:32:49.405046+00	2026-05-27 02:32:32.552+00
0c0a89e5-4741-4d9c-ad1f-16ffa7a67bcb	06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	http://localhost:4000/api/media/emaseo-incidents/incidents/a024c945-83fa-41e4-9273-7afed4e385a4.jpg	t	2026-05-27 03:34:12.412221+00	2026-05-27 03:34:07.832+00
\.


--
-- Data for Name: incidents; Type: TABLE DATA; Schema: incidents; Owner: -
--

COPY incidents.incidents (id, reportado_por, descripcion, ubicacion, direccion, estado, prioridad, zona_id, nota_fallo, created_at, updated_at, resuelto_at, ubicacion_aproximada, celery_task_id, pending_s3_key, decision_automatica, confianza_decision, imagen_auditoria_url) FROM stdin;
45d30abe-7f8d-468a-96d6-d050d5915802	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000603F1FC07D9C53C049EE55D0590BD4BF	\N	FALLIDO	BAJA	b2000000-0000-0000-0000-000000000004	error al registrar resultado negativo: null value in column "confianza" of relation "analysis_results" violates not-null constraint	2026-05-27 00:35:09.098191+00	2026-05-27 00:35:23.516172+00	\N	f	\N	\N	ERROR_TECNICO	\N	http://localhost:4000/api/media/emaseo-incidents/incidents/121c5807-7bd7-4883-a9bb-ddaa2e4f436e.jpg
7f43599b-e8cd-4476-8744-6a0679fb2f17	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000765BD889819C53C01A6D5512D907D4BF	\N	RECHAZADA	CRITICA	b2000000-0000-0000-0000-000000000004	\N	2026-05-26 21:42:42.077472+00	2026-05-27 00:54:21.826739+00	\N	f	\N	\N	INCIDENTE_VALIDO	\N	\N
2bc1fa03-94d7-4a40-9831-595283fa0e52	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000F8489407B3A053C07A5798199103D1BF	\N	PENDIENTE	BAJA	b2000000-0000-0000-0000-000000000003	\N	2026-05-26 21:50:37.656236+00	2026-05-26 21:50:46.392191+00	\N	f	\N	\N	INCIDENTE_VALIDO	\N	\N
d932e38c-7f65-46b0-8ce9-a88ede57ca16	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000A070766B999B53C0669D96C4FE57D6BF	\N	FALLIDO	BAJA	\N	DB transaction: column "incident_created_at" of relation "incident_images" does not exist	2026-05-25 12:02:09.228437+00	2026-05-25 17:28:48.817206+00	\N	f	\N	\N	ERROR_TECNICO	\N	\N
29c155b6-0dbb-450c-86c5-7b2e0ad4ac0b	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E61000008257CB9D999B53C0CF79D7EABC57D6BF	\N	FALLIDO	BAJA	\N	DB transaction: column "incident_created_at" of relation "incident_images" does not exist	2026-05-25 12:07:18.986864+00	2026-05-25 17:28:48.817206+00	\N	f	\N	\N	ERROR_TECNICO	\N	\N
445c4192-bf7d-48ae-9dde-bd070b2dc015	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000635BABE2B2A053C066B098C75004D1BF	\N	FALLIDO	BAJA	b2000000-0000-0000-0000-000000000003	DB transaction: column "incident_created_at" of relation "incident_images" does not exist	2026-05-25 16:16:21.579614+00	2026-05-25 17:28:48.817206+00	\N	f	\N	\N	ERROR_TECNICO	\N	\N
037eef6f-9830-415d-bb75-54b37f248ec3	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000FEF15EB5B2A053C016E6F3401A04D1BF	\N	FALLIDO	BAJA	b2000000-0000-0000-0000-000000000003	DB transaction: column "incident_created_at" of relation "incident_images" does not exist	2026-05-25 16:17:14.117042+00	2026-05-25 17:28:48.817206+00	\N	f	\N	\N	ERROR_TECNICO	\N	\N
d47514e0-d506-4f91-b2aa-1701ea66ece8	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E61000002510655E7D9C53C09E3B6645790BD4BF	\N	PENDIENTE	MEDIA	b2000000-0000-0000-0000-000000000004	\N	2026-05-27 00:21:17.399919+00	2026-05-27 00:21:34.368487+00	\N	f	\N	\N	INCIDENTE_VALIDO	\N	\N
faf93d32-dc06-4883-a967-3d090690c78d	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E61000008A90BA9D7D9C53C092BEFF45860BD4BF	\N	FALLIDO	BAJA	b2000000-0000-0000-0000-000000000004	error al registrar resultado negativo: null value in column "confianza" of relation "analysis_results" violates not-null constraint	2026-05-27 00:34:44.607443+00	2026-05-27 00:34:54.650439+00	\N	f	\N	\N	ERROR_TECNICO	\N	http://localhost:4000/api/media/emaseo-incidents/incidents/5595d44e-d824-463a-a0ff-23e9ee4d43b6.jpg
38e73b2c-da8c-49ae-88bc-d4c7f2998975	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E61000002E8782BE999B53C007F1DCD67157D6BF	\N	PENDIENTE	MEDIA	\N	Sin zona operativa cubre esta ubicaci??n GPS	2026-05-27 02:32:32.552186+00	2026-05-27 02:32:49.405046+00	\N	f	\N	\N	INCIDENTE_VALIDO	\N	\N
aa77f234-d5cf-4255-a73b-6c6df7072d96	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000767BFFD5999B53C050C1864C9E57D6BF	\N	FALLIDO	BAJA	\N	error al registrar resultado negativo: null value in column "confianza" of relation "analysis_results" violates not-null constraint	2026-05-27 03:33:02.783561+00	2026-05-27 03:33:17.601534+00	\N	f	\N	\N	ERROR_TECNICO	\N	http://localhost:4000/api/media/emaseo-incidents/incidents/2c220e90-88c5-447f-a0f7-fb63c164ba41.jpg
06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	91fc74b5-df46-456f-9687-b8904dd37c7d	\N	0101000020E6100000EDDC0FD3999B53C0BE0864C0A357D6BF	\N	PENDIENTE	BAJA	\N	Sin zona operativa cubre esta ubicaci??n GPS	2026-05-27 03:34:07.832063+00	2026-05-27 03:34:12.412221+00	\N	f	\N	\N	INCIDENTE_VALIDO	\N	\N
\.


--
-- Data for Name: status_history; Type: TABLE DATA; Schema: incidents; Owner: -
--

COPY incidents.status_history (id, incident_id, estado_anterior, estado_nuevo, cambiado_por, observaciones, created_at, incident_created_at) FROM stdin;
c129028a-0e24-44e6-97eb-d87064d91865	d932e38c-7f65-46b0-8ce9-a88ede57ca16	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-25 12:02:09.228437+00	2026-05-25 12:02:09.228437+00
4c395934-1234-4b12-ba01-eb633303b4b0	d932e38c-7f65-46b0-8ce9-a88ede57ca16	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-25 12:02:30.353699+00	2026-05-25 12:02:09.228437+00
0242b758-bf22-474f-916c-1a39f91517ab	29c155b6-0dbb-450c-86c5-7b2e0ad4ac0b	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-25 12:07:18.986864+00	2026-05-25 12:07:18.986864+00
2975eace-5485-4d44-bf45-6295381d2e48	29c155b6-0dbb-450c-86c5-7b2e0ad4ac0b	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-25 12:07:32.107655+00	2026-05-25 12:07:18.986864+00
22275f4d-05e5-4a52-9bfc-a0621c9f78a2	445c4192-bf7d-48ae-9dde-bd070b2dc015	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-25 16:16:21.579614+00	2026-05-25 16:16:21.579614+00
ad9e0b0f-01cf-4e35-8ea5-55cae5c60ee0	445c4192-bf7d-48ae-9dde-bd070b2dc015	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-25 16:16:41.569788+00	2026-05-25 16:16:21.579614+00
649593ee-f664-43c4-a754-f0daa5da5b8d	037eef6f-9830-415d-bb75-54b37f248ec3	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-25 16:17:14.117042+00	2026-05-25 16:17:14.117042+00
ba1fea12-04da-4ff2-9a72-50a08536b16b	037eef6f-9830-415d-bb75-54b37f248ec3	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-25 16:17:24.271124+00	2026-05-25 16:17:14.117042+00
4f0c0731-7bd1-4855-ad9e-55e5625d7184	7f43599b-e8cd-4476-8744-6a0679fb2f17	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-26 21:42:42.077472+00	\N
0e55a46d-38e8-4dec-b835-dfa1fb52be33	7f43599b-e8cd-4476-8744-6a0679fb2f17	PROCESANDO	PENDIENTE	00000000-0000-0000-0000-000000000001	\N	2026-05-26 21:42:58.862619+00	\N
4aaafae6-5596-4611-ae65-e8d82884124d	2bc1fa03-94d7-4a40-9831-595283fa0e52	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-26 21:50:37.656236+00	\N
651d2877-ce54-4b38-82dc-5f743c7f98c3	2bc1fa03-94d7-4a40-9831-595283fa0e52	PROCESANDO	PENDIENTE	00000000-0000-0000-0000-000000000001	\N	2026-05-26 21:50:46.392191+00	\N
dee0fe31-88ed-47eb-9f7a-b29a3608c782	d47514e0-d506-4f91-b2aa-1701ea66ece8	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 00:21:17.399919+00	\N
ed80d96a-4089-4f76-b60c-0f888576cad6	d47514e0-d506-4f91-b2aa-1701ea66ece8	PROCESANDO	PENDIENTE	00000000-0000-0000-0000-000000000001	\N	2026-05-27 00:21:34.368487+00	\N
ef859dd0-58e9-42b5-9a1e-1e395e60add3	faf93d32-dc06-4883-a967-3d090690c78d	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 00:34:44.607443+00	\N
c140095b-be88-4d17-b295-6e6c19ca2c75	faf93d32-dc06-4883-a967-3d090690c78d	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-27 00:34:54.650439+00	\N
29b12f7a-c294-4e4b-8dd4-6cc4719065c4	45d30abe-7f8d-468a-96d6-d050d5915802	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 00:35:09.098191+00	\N
606969cf-4b26-45e1-81f2-4692b090e6ea	45d30abe-7f8d-468a-96d6-d050d5915802	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-27 00:35:23.516172+00	\N
897597bd-2810-44ff-908b-adfc92fa463d	7f43599b-e8cd-4476-8744-6a0679fb2f17	PENDIENTE	RECHAZADA	a1000000-0000-0000-0000-000000000002	\N	2026-05-27 00:54:21.826739+00	\N
f50f8fad-5d64-41c3-9d6e-281d2bf0beac	38e73b2c-da8c-49ae-88bc-d4c7f2998975	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 02:32:32.552186+00	\N
ce3014ac-ccae-4ffe-bfec-4c08bda1b129	38e73b2c-da8c-49ae-88bc-d4c7f2998975	PROCESANDO	PENDIENTE	00000000-0000-0000-0000-000000000001	\N	2026-05-27 02:32:49.405046+00	\N
02f41103-d354-4234-8aaa-8e5fb0543798	aa77f234-d5cf-4255-a73b-6c6df7072d96	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 03:33:02.783561+00	\N
53c937d9-68f9-414d-85ae-80dd63c72eaf	aa77f234-d5cf-4255-a73b-6c6df7072d96	PROCESANDO	FALLIDO	00000000-0000-0000-0000-000000000001	\N	2026-05-27 03:33:17.601534+00	\N
71799b3a-0d15-4340-9f2e-9d22ae456a5e	06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	\N	PROCESANDO	91fc74b5-df46-456f-9687-b8904dd37c7d	Estado inicial al crear incidente	2026-05-27 03:34:07.832063+00	\N
ed827bb3-7cbd-4997-afd1-65cd831cf746	06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	PROCESANDO	PENDIENTE	00000000-0000-0000-0000-000000000001	\N	2026-05-27 03:34:12.412221+00	\N
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: notifications; Owner: -
--

COPY notifications.notifications (id, usuario_id, incident_id, titulo, mensaje, canal, estado, leida_at, enviada_at, created_at, intentos, ultimo_intento_at, error_detalle, proximo_intento_at, incident_created_at) FROM stdin;
0bdfcb98-eb51-4994-8f68-bd96c4f1af89	91fc74b5-df46-456f-9687-b8904dd37c7d	7f43599b-e8cd-4476-8744-6a0679fb2f17	Reporte aceptado	Tu reporte fue validado. Prioridad asignada: CRITICA.	PUSH	PENDIENTE	\N	\N	2026-05-26 21:42:58.862619+00	0	\N	\N	\N	\N
87ac3d07-0c9e-486b-bc38-216ff6d1b911	91fc74b5-df46-456f-9687-b8904dd37c7d	2bc1fa03-94d7-4a40-9831-595283fa0e52	Reporte aceptado	Tu reporte fue validado. Prioridad asignada: BAJA.	PUSH	PENDIENTE	\N	\N	2026-05-26 21:50:46.392191+00	0	\N	\N	\N	\N
d9161af9-033f-44f7-ab3e-bcbac46de433	91fc74b5-df46-456f-9687-b8904dd37c7d	d47514e0-d506-4f91-b2aa-1701ea66ece8	Reporte aceptado	Tu reporte fue validado. Prioridad asignada: MEDIA.	PUSH	PENDIENTE	\N	\N	2026-05-27 00:21:34.368487+00	0	\N	\N	\N	\N
516d73b5-6563-4c77-bd2d-307d52783249	91fc74b5-df46-456f-9687-b8904dd37c7d	7f43599b-e8cd-4476-8744-6a0679fb2f17	Reporte rechazado	Tu reporte fue revisado y no pudo ser atendido en esta ocasión. Puedes enviar uno nuevo con más detalle.	PUSH	PENDIENTE	\N	\N	2026-05-27 00:54:21.826739+00	0	\N	\N	\N	\N
d441c760-d5df-4876-9b14-ce7d3620623e	91fc74b5-df46-456f-9687-b8904dd37c7d	38e73b2c-da8c-49ae-88bc-d4c7f2998975	Reporte aceptado	Tu reporte fue validado. Prioridad asignada: MEDIA.	PUSH	PENDIENTE	\N	\N	2026-05-27 02:32:49.405046+00	0	\N	\N	\N	\N
4517d326-6c39-4b8c-9129-c8fd4832ab90	91fc74b5-df46-456f-9687-b8904dd37c7d	06ac2c2a-5b40-47a0-b04a-fcdf68b1d7fa	Reporte aceptado	Tu reporte fue validado. Prioridad asignada: BAJA.	PUSH	PENDIENTE	\N	\N	2026-05-27 03:34:12.412221+00	0	\N	\N	\N	\N
\.


--
-- Data for Name: operarios; Type: TABLE DATA; Schema: operations; Owner: -
--

COPY operations.operarios (id, user_id, nombre, apellido, cedula, telefono, zona_id, cargo, created_at, updated_at) FROM stdin;
c0d25ef6-235f-4420-b1b4-aa880cd0103b	a1000000-0000-0000-0000-000000000001	Carlos	Administrador	1700000100	0991000001	\N	Administrador del Sistema	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
d1cba184-17f9-410d-9f0a-b29bfae42232	a1000000-0000-0000-0000-000000000002	Maria	Lopez	1700001009	0991000002	b2000000-0000-0000-0000-000000000001	Supervisora Zona Centro	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
293496dc-93f0-447e-a471-071cf6b9ffe8	a1000000-0000-0000-0000-000000000003	Pedro	Garcia	1700010000	0991000003	b2000000-0000-0000-0000-000000000001	Operario de Campo	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
2dee1ec4-bdab-4824-82aa-118db7fb6e5f	a1000000-0000-0000-0000-000000000004	Luis	Martinez	1700100009	0991000004	b2000000-0000-0000-0000-000000000002	Operario de Campo	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
\.


--
-- Data for Name: zones; Type: TABLE DATA; Schema: operations; Owner: -
--

COPY operations.zones (id, codigo, nombre, descripcion, geom, supervisor_id, activa, created_at, updated_at) FROM stdin;
b2000000-0000-0000-0000-000000000001	ZN-CENTRO-01	Centro Historico	Zona del centro historico de Quito — alta densidad poblacional y patrimonio cultural	0103000020E610000001000000050000000AD7A3703DA253C0B81E85EB51B8CEBFB81E85EB51A053C0B81E85EB51B8CEBFB81E85EB51A053C0E17A14AE47E1CABF0AD7A3703DA253C0E17A14AE47E1CABF0AD7A3703DA253C0B81E85EB51B8CEBF	a1000000-0000-0000-0000-000000000002	t	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
b2000000-0000-0000-0000-000000000002	ZN-NORTE-01	Norte — La Carolina	Sector norte de Quito: La Carolina, Inanez, Republica del Salvador — zona comercial y residencial	0103000020E61000000100000005000000713D0AD7A3A053C0AE47E17A14AEC7BFF6285C8FC29D53C0AE47E17A14AEC7BFF6285C8FC29D53C0D7A3703D0AD7C3BF713D0AD7A3A053C0D7A3703D0AD7C3BF713D0AD7A3A053C0AE47E17A14AEC7BF	a1000000-0000-0000-0000-000000000002	t	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
b2000000-0000-0000-0000-000000000003	ZN-SUR-01	Sur — Solanda	Sector sur de Quito: Solanda, Turubamba, La Ecuatoriana — zona residencial alta densidad	0103000020E61000000100000005000000EC51B81E85A353C0E17A14AE47E1D2BF713D0AD7A3A053C0E17A14AE47E1D2BF713D0AD7A3A053C052B81E85EB51D0BFEC51B81E85A353C052B81E85EB51D0BFEC51B81E85A353C0E17A14AE47E1D2BF	a1000000-0000-0000-0000-000000000002	t	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
b2000000-0000-0000-0000-000000000004	ZN-ORIENTE-01	Valle de Los Chillos	Sector oriental: San Rafael, Sangolqui, Conocoto — zona periurbana en expansion	0103000020E610000001000000050000003D0AD7A3709D53C0C3F5285C8FC2D5BFC3F5285C8F9A53C0C3F5285C8FC2D5BFC3F5285C8F9A53C0E17A14AE47E1D2BF3D0AD7A3709D53C0E17A14AE47E1D2BF3D0AD7A3709D53C0C3F5285C8FC2D5BF	a1000000-0000-0000-0000-000000000002	t	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
\.


--
-- Data for Name: ciudadanos; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ciudadanos (id, user_id, nombre, apellido, cedula, telefono, avatar_url, created_at, updated_at) FROM stdin;
650065c6-ffda-4c88-8e27-267b7158bde1	a1000000-0000-0000-0000-000000000005	Ana	Ciudadana	1700000001	0991000005	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
2d091d74-b7e6-4686-aeb8-ad06b1dfd2be	a1000000-0000-0000-0000-000000000006	Jorge	Ramirez	1700000019	0991000006	\N	2026-05-20 21:11:33.255708+00	2026-05-20 21:11:33.255708+00
0386d2ea-8dd5-464e-9261-418adeb2805a	91fc74b5-df46-456f-9687-b8904dd37c7d	Bryan	Ortiz	1724345283	\N	\N	2026-05-20 22:19:15.610362+00	2026-05-20 22:19:15.610362+00
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: geocode_settings; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.geocode_settings (name, setting, unit, category, short_desc) FROM stdin;
\.


--
-- Data for Name: pagc_gaz; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_gaz (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_lex; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_lex (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_rules; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_rules (id, rule, is_custom) FROM stdin;
\.


--
-- Data for Name: topology; Type: TABLE DATA; Schema: topology; Owner: -
--

COPY topology.topology (id, name, srid, "precision", hasz) FROM stdin;
\.


--
-- Data for Name: layer; Type: TABLE DATA; Schema: topology; Owner: -
--

COPY topology.layer (topology_id, layer_id, schema_name, table_name, feature_column, feature_type, level, child_id) FROM stdin;
\.


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: audit; Owner: -
--

SELECT pg_catalog.setval('audit.audit_log_id_seq', 1, false);


--
-- Name: topology_id_seq; Type: SEQUENCE SET; Schema: topology; Owner: -
--

SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);


--
-- Name: analysis_feedback analysis_feedback_pkey; Type: CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_feedback
    ADD CONSTRAINT analysis_feedback_pkey PRIMARY KEY (id);


--
-- Name: analysis_results analysis_results_incident_id_key; Type: CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_results
    ADD CONSTRAINT analysis_results_incident_id_key UNIQUE (incident_id);


--
-- Name: analysis_results analysis_results_pkey; Type: CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_results
    ADD CONSTRAINT analysis_results_pkey PRIMARY KEY (id);


--
-- Name: analysis_feedback uq_feedback_per_user; Type: CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_feedback
    ADD CONSTRAINT uq_feedback_per_user UNIQUE (analysis_result_id, reportado_por);


--
-- Name: device_tokens device_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.device_tokens
    ADD CONSTRAINT device_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_tokens device_tokens_token_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.device_tokens
    ADD CONSTRAINT device_tokens_token_key UNIQUE (token);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: pending_registrations pending_registrations_email_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.pending_registrations
    ADD CONSTRAINT pending_registrations_email_key UNIQUE (email);


--
-- Name: pending_registrations pending_registrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.pending_registrations
    ADD CONSTRAINT pending_registrations_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: incident_images incident_images_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_images
    ADD CONSTRAINT incident_images_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: status_history status_history_pkey; Type: CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.status_history
    ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: notifications; Owner: -
--

ALTER TABLE ONLY notifications.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: operarios operarios_cedula_key; Type: CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.operarios
    ADD CONSTRAINT operarios_cedula_key UNIQUE (cedula);


--
-- Name: operarios operarios_pkey; Type: CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.operarios
    ADD CONSTRAINT operarios_pkey PRIMARY KEY (id);


--
-- Name: operarios operarios_user_id_key; Type: CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.operarios
    ADD CONSTRAINT operarios_user_id_key UNIQUE (user_id);


--
-- Name: zones zones_codigo_key; Type: CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.zones
    ADD CONSTRAINT zones_codigo_key UNIQUE (codigo);


--
-- Name: zones zones_pkey; Type: CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.zones
    ADD CONSTRAINT zones_pkey PRIMARY KEY (id);


--
-- Name: ciudadanos ciudadanos_cedula_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciudadanos
    ADD CONSTRAINT ciudadanos_cedula_key UNIQUE (cedula);


--
-- Name: ciudadanos ciudadanos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciudadanos
    ADD CONSTRAINT ciudadanos_pkey PRIMARY KEY (id);


--
-- Name: ciudadanos ciudadanos_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciudadanos
    ADD CONSTRAINT ciudadanos_user_id_key UNIQUE (user_id);


--
-- Name: idx_ai_detecciones_gin; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_detecciones_gin ON ai.analysis_results USING gin (detecciones);


--
-- Name: idx_ai_ia_incorrecta; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_ia_incorrecta ON ai.analysis_results USING btree (supervisado_at DESC) WHERE (ia_fue_correcta = false);


--
-- Name: idx_ai_nivel_acumulacion; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_nivel_acumulacion ON ai.analysis_results USING btree (nivel_acumulacion);


--
-- Name: idx_ai_pendiente_revision; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_pendiente_revision ON ai.analysis_results USING btree (created_at DESC) WHERE (supervisado_por IS NULL);


--
-- Name: idx_ai_supervisado; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_supervisado ON ai.analysis_results USING btree (supervisado_por, supervisado_at DESC) WHERE (supervisado_por IS NOT NULL);


--
-- Name: idx_ai_tipo_residuo; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_ai_tipo_residuo ON ai.analysis_results USING btree (tipo_residuo);


--
-- Name: idx_feedback_analysis; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_feedback_analysis ON ai.analysis_feedback USING btree (analysis_result_id);


--
-- Name: idx_feedback_incorrectos; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_feedback_incorrectos ON ai.analysis_feedback USING btree (es_correcta) WHERE (es_correcta = false);


--
-- Name: idx_feedback_usuario; Type: INDEX; Schema: ai; Owner: -
--

CREATE INDEX idx_feedback_usuario ON ai.analysis_feedback USING btree (reportado_por);


--
-- Name: idx_audit_log_ocurrido_at; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_log_ocurrido_at ON ONLY audit.audit_log USING btree (ocurrido_at DESC);


--
-- Name: audit_log_2026_05_ocurrido_at_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX audit_log_2026_05_ocurrido_at_idx ON audit.audit_log_2026_05 USING btree (ocurrido_at DESC);


--
-- Name: audit_log_2026_06_ocurrido_at_idx; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX audit_log_2026_06_ocurrido_at_idx ON audit.audit_log_2026_06 USING btree (ocurrido_at DESC);


--
-- Name: idx_device_tokens_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_device_tokens_user ON auth.device_tokens USING btree (user_id);


--
-- Name: idx_pending_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_pending_created_at ON auth.pending_registrations USING btree (created_at);


--
-- Name: idx_prt_expires_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_prt_expires_at ON auth.password_reset_tokens USING btree (expires_at);


--
-- Name: idx_prt_otp_hash; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_prt_otp_hash ON auth.password_reset_tokens USING btree (otp_hash);


--
-- Name: idx_prt_user_id; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_prt_user_id ON auth.password_reset_tokens USING btree (user_id);


--
-- Name: idx_rt_token_hash; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_rt_token_hash ON auth.refresh_tokens USING btree (token_hash);


--
-- Name: idx_rt_user_id; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_rt_user_id ON auth.refresh_tokens USING btree (user_id);


--
-- Name: idx_users_estado; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_estado ON auth.users USING btree (estado);


--
-- Name: idx_users_rol; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_rol ON auth.users USING btree (rol);


--
-- Name: idx_asg_asignado_por; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_asg_asignado_por ON incidents.assignments USING btree (asignado_por);


--
-- Name: idx_assignments_completada; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_assignments_completada ON incidents.assignments USING btree (completada) WHERE (completada = false);


--
-- Name: idx_assignments_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_assignments_incident ON incidents.assignments USING btree (incident_id);


--
-- Name: idx_assignments_operario; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_assignments_operario ON incidents.assignments USING btree (operario_id);


--
-- Name: idx_images_incident_id; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_images_incident_id ON incidents.incident_images USING btree (incident_id);


--
-- Name: idx_incidents_celery_pending; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_celery_pending ON incidents.incidents USING btree (celery_task_id) WHERE ((celery_task_id IS NOT NULL) AND (estado = 'PROCESANDO'::incidents.incident_status));


--
-- Name: idx_incidents_created_at; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_created_at ON incidents.incidents USING btree (created_at DESC);


--
-- Name: idx_incidents_decision_automatica; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_decision_automatica ON incidents.incidents USING btree (decision_automatica) WHERE (decision_automatica IS NOT NULL);


--
-- Name: idx_incidents_descartado; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_descartado ON incidents.incidents USING btree (created_at DESC) WHERE (estado = 'DESCARTADO'::incidents.incident_status);


--
-- Name: idx_incidents_en_revision; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_en_revision ON incidents.incidents USING btree (created_at DESC) WHERE (estado = 'EN_REVISION'::incidents.incident_status);


--
-- Name: idx_incidents_estado; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_estado ON incidents.incidents USING btree (estado);


--
-- Name: idx_incidents_estado_prioridad; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_estado_prioridad ON incidents.incidents USING btree (estado, prioridad);


--
-- Name: idx_incidents_owner_estado; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_owner_estado ON incidents.incidents USING btree (reportado_por, estado, created_at DESC);


--
-- Name: idx_incidents_prioridad; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_prioridad ON incidents.incidents USING btree (prioridad);


--
-- Name: idx_incidents_reportado_por; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_reportado_por ON incidents.incidents USING btree (reportado_por);


--
-- Name: idx_incidents_ubicacion_gist; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_ubicacion_gist ON incidents.incidents USING gist (ubicacion);


--
-- Name: idx_incidents_zona_id; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_incidents_zona_id ON incidents.incidents USING btree (zona_id);


--
-- Name: idx_sh_cambiado_por; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_sh_cambiado_por ON incidents.status_history USING btree (cambiado_por);


--
-- Name: idx_status_history_created; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_status_history_created ON incidents.status_history USING btree (created_at DESC);


--
-- Name: idx_status_history_incident; Type: INDEX; Schema: incidents; Owner: -
--

CREATE INDEX idx_status_history_incident ON incidents.status_history USING btree (incident_id);


--
-- Name: uq_assignment_activa; Type: INDEX; Schema: incidents; Owner: -
--

CREATE UNIQUE INDEX uq_assignment_activa ON incidents.assignments USING btree (incident_id, operario_id) WHERE (completada = false);


--
-- Name: idx_notif_created_at; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_created_at ON notifications.notifications USING btree (created_at DESC);


--
-- Name: idx_notif_estado; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_estado ON notifications.notifications USING btree (estado);


--
-- Name: idx_notif_incident; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_incident ON notifications.notifications USING btree (incident_id);


--
-- Name: idx_notif_no_leidas; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_no_leidas ON notifications.notifications USING btree (usuario_id, estado) WHERE (estado = ANY (ARRAY['PENDIENTE'::notifications.notification_status, 'ENVIADA'::notifications.notification_status]));


--
-- Name: idx_notif_retry; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_retry ON notifications.notifications USING btree (proximo_intento_at) WHERE ((estado = 'FALLIDA'::notifications.notification_status) AND (intentos < 5));


--
-- Name: idx_notif_usuario; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_usuario ON notifications.notifications USING btree (usuario_id);


--
-- Name: idx_notif_usuario_fecha; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notif_usuario_fecha ON notifications.notifications USING btree (usuario_id, created_at DESC);


--
-- Name: idx_notifications_push_pending; Type: INDEX; Schema: notifications; Owner: -
--

CREATE INDEX idx_notifications_push_pending ON notifications.notifications USING btree (usuario_id, created_at) WHERE ((estado = 'PENDIENTE'::notifications.notification_status) AND (canal = 'PUSH'::notifications.channel_type));


--
-- Name: INDEX idx_notifications_push_pending; Type: COMMENT; Schema: notifications; Owner: -
--

COMMENT ON INDEX notifications.idx_notifications_push_pending IS '??ndice parcial para el push-worker: cubre (usuario_id, created_at) en notificaciones PUSH pendientes';


--
-- Name: idx_operarios_cedula; Type: INDEX; Schema: operations; Owner: -
--

CREATE INDEX idx_operarios_cedula ON operations.operarios USING btree (cedula);


--
-- Name: idx_operarios_zona; Type: INDEX; Schema: operations; Owner: -
--

CREATE INDEX idx_operarios_zona ON operations.operarios USING btree (zona_id);


--
-- Name: idx_zones_geom_gist; Type: INDEX; Schema: operations; Owner: -
--

CREATE INDEX idx_zones_geom_gist ON operations.zones USING gist (geom);


--
-- Name: idx_ciudadanos_cedula; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ciudadanos_cedula ON public.ciudadanos USING btree (cedula);


--
-- Name: audit_log_2026_05_ocurrido_at_idx; Type: INDEX ATTACH; Schema: audit; Owner: -
--

ALTER INDEX audit.idx_audit_log_ocurrido_at ATTACH PARTITION audit.audit_log_2026_05_ocurrido_at_idx;


--
-- Name: audit_log_2026_06_ocurrido_at_idx; Type: INDEX ATTACH; Schema: audit; Owner: -
--

ALTER INDEX audit.idx_audit_log_ocurrido_at ATTACH PARTITION audit.audit_log_2026_06_ocurrido_at_idx;


--
-- Name: analysis_feedback trg_feedback_updated_at; Type: TRIGGER; Schema: ai; Owner: -
--

CREATE TRIGGER trg_feedback_updated_at BEFORE UPDATE ON ai.analysis_feedback FOR EACH ROW EXECUTE FUNCTION ai.fn_touch_feedback_updated_at();


--
-- Name: users trg_users_updated_at; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: incidents trg_05_log_initial_status; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_05_log_initial_status AFTER INSERT ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION incidents.fn_log_initial_status();


--
-- Name: incidents trg_10_log_status_change; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_10_log_status_change BEFORE UPDATE OF estado ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION incidents.fn_log_status_change();


--
-- Name: incidents trg_20_notify_citizen; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_20_notify_citizen AFTER UPDATE OF estado ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION incidents.fn_notify_citizen();


--
-- Name: assignments trg_assignments_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_assignments_updated_at BEFORE UPDATE ON incidents.assignments FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: incidents trg_auto_assign_zone; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_auto_assign_zone BEFORE INSERT OR UPDATE OF ubicacion ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION incidents.fn_assign_zone();


--
-- Name: incidents trg_incidents_updated_at; Type: TRIGGER; Schema: incidents; Owner: -
--

CREATE TRIGGER trg_incidents_updated_at BEFORE UPDATE ON incidents.incidents FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: operarios trg_operarios_updated_at; Type: TRIGGER; Schema: operations; Owner: -
--

CREATE TRIGGER trg_operarios_updated_at BEFORE UPDATE ON operations.operarios FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: zones trg_zones_updated_at; Type: TRIGGER; Schema: operations; Owner: -
--

CREATE TRIGGER trg_zones_updated_at BEFORE UPDATE ON operations.zones FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: ciudadanos trg_ciudadanos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ciudadanos_updated_at BEFORE UPDATE ON public.ciudadanos FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: analysis_feedback analysis_feedback_analysis_result_id_fkey; Type: FK CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_feedback
    ADD CONSTRAINT analysis_feedback_analysis_result_id_fkey FOREIGN KEY (analysis_result_id) REFERENCES ai.analysis_results(id) ON DELETE CASCADE;


--
-- Name: analysis_feedback analysis_feedback_reportado_por_fkey; Type: FK CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_feedback
    ADD CONSTRAINT analysis_feedback_reportado_por_fkey FOREIGN KEY (reportado_por) REFERENCES auth.users(id);


--
-- Name: analysis_results analysis_results_incident_id_fkey; Type: FK CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_results
    ADD CONSTRAINT analysis_results_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE CASCADE;


--
-- Name: analysis_results analysis_results_supervisado_por_fkey; Type: FK CONSTRAINT; Schema: ai; Owner: -
--

ALTER TABLE ONLY ai.analysis_results
    ADD CONSTRAINT analysis_results_supervisado_por_fkey FOREIGN KEY (supervisado_por) REFERENCES auth.users(id);


--
-- Name: device_tokens device_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.device_tokens
    ADD CONSTRAINT device_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: assignments assignments_asignado_por_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.assignments
    ADD CONSTRAINT assignments_asignado_por_fkey FOREIGN KEY (asignado_por) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: assignments assignments_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.assignments
    ADD CONSTRAINT assignments_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE CASCADE;


--
-- Name: assignments assignments_operario_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.assignments
    ADD CONSTRAINT assignments_operario_id_fkey FOREIGN KEY (operario_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: incident_images incident_images_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incident_images
    ADD CONSTRAINT incident_images_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE CASCADE;


--
-- Name: incidents incidents_reportado_por_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents
    ADD CONSTRAINT incidents_reportado_por_fkey FOREIGN KEY (reportado_por) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: incidents incidents_zona_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.incidents
    ADD CONSTRAINT incidents_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES operations.zones(id) ON DELETE SET NULL;


--
-- Name: status_history status_history_cambiado_por_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.status_history
    ADD CONSTRAINT status_history_cambiado_por_fkey FOREIGN KEY (cambiado_por) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- Name: status_history status_history_incident_id_fkey; Type: FK CONSTRAINT; Schema: incidents; Owner: -
--

ALTER TABLE ONLY incidents.status_history
    ADD CONSTRAINT status_history_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_incident_id_fkey; Type: FK CONSTRAINT; Schema: notifications; Owner: -
--

ALTER TABLE ONLY notifications.notifications
    ADD CONSTRAINT notifications_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES incidents.incidents(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_usuario_id_fkey; Type: FK CONSTRAINT; Schema: notifications; Owner: -
--

ALTER TABLE ONLY notifications.notifications
    ADD CONSTRAINT notifications_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: operarios fk_operarios_zona; Type: FK CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.operarios
    ADD CONSTRAINT fk_operarios_zona FOREIGN KEY (zona_id) REFERENCES operations.zones(id) ON DELETE SET NULL;


--
-- Name: operarios operarios_user_id_fkey; Type: FK CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.operarios
    ADD CONSTRAINT operarios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: zones zones_supervisor_id_fkey; Type: FK CONSTRAINT; Schema: operations; Owner: -
--

ALTER TABLE ONLY operations.zones
    ADD CONSTRAINT zones_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: ciudadanos ciudadanos_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ciudadanos
    ADD CONSTRAINT ciudadanos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

