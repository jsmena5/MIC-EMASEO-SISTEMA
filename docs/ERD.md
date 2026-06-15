# MIC-EMASEO SISTEMA — Diagrama Entidad-Relación

**Estado:** Post-migración 056 · 2026-06-14  
**Base de datos:** PostgreSQL 15+ · PostGIS · Supabase

```mermaid
erDiagram

    %% ── app_auth ─────────────────────────────────────────────────────────────

    USERS {
        UUID    id PK
        VARCHAR email UK
        VARCHAR password_hash
        ENUM    rol
        ENUM    estado
        BOOL    is_verified
        VARCHAR nombre
        VARCHAR apellido
        VARCHAR segundo_nombre
        VARCHAR segundo_apellido
        VARCHAR cedula UK
        VARCHAR telefono
        DATE    fecha_nacimiento
        VARCHAR sexo
        VARCHAR avatar_url
        UUID    zona_id FK
        VARCHAR cargo
        TSTZ    ultimo_login
        TSTZ    created_at
        TSTZ    updated_at
    }

    REFRESH_TOKENS {
        UUID    id PK
        UUID    user_id FK
        TEXT    token_hash UK
        TSTZ    expires_at
        BOOL    revoked
        TSTZ    created_at
    }

    PASSWORD_RESET_TOKENS {
        UUID    id PK
        UUID    user_id FK
        TEXT    otp_hash
        TSTZ    expires_at
        BOOL    used
        TSTZ    created_at
    }

    PENDING_REGISTRATIONS {
        UUID    id PK
        VARCHAR nombre
        VARCHAR apellido
        VARCHAR cedula
        VARCHAR email UK
        VARCHAR telefono
        DATE    fecha_nacimiento
        VARCHAR sexo
        VARCHAR otp_code
        TSTZ    otp_expires_at
        BOOL    is_verified
        TSTZ    created_at
    }

    USER_CONSENTS {
        UUID    id PK
        UUID    user_id FK
        VARCHAR version_politica
        TSTZ    aceptada_at
        INET    ip_origen
        TEXT    user_agent
        TSTZ    revocada_at
    }

    DEVICE_TOKENS {
        UUID    id PK
        UUID    user_id FK
        TEXT    token UK
        VARCHAR platform
        VARCHAR app_version
        TSTZ    last_seen_at
        TSTZ    created_at
    }

    %% ── operations ───────────────────────────────────────────────────────────

    ZONES {
        UUID    id PK
        VARCHAR codigo UK
        VARCHAR nombre
        TEXT    descripcion
        GEOM    geom
        UUID    supervisor_id FK
        BOOL    activa
        TSTZ    created_at
        TSTZ    updated_at
    }

    CONFIG {
        VARCHAR clave PK
        TEXT    valor
        TEXT    descripcion
        TSTZ    updated_at
    }

    %% ── incidents ────────────────────────────────────────────────────────────

    INCIDENTS {
        UUID    id PK
        TSTZ    created_at PK
        UUID    reportado_por FK
        TEXT    descripcion
        GEOM    ubicacion
        VARCHAR direccion
        ENUM    estado
        ENUM    prioridad
        UUID    zona_id FK
        TEXT    nota_fallo
        BOOL    ubicacion_aproximada
        VARCHAR decision_automatica
        NUMERIC confianza_decision
        VARCHAR imagen_auditoria_url
        VARCHAR celery_task_id
        DOUBLE  cierre_lat
        DOUBLE  cierre_lon
        NUMERIC cierre_distancia_m
        ENUM    etiqueta_entrenamiento
        TEXT    comentario_etiquetado
        UUID    etiquetado_por FK
        TSTZ    etiquetado_en
        UUID    idempotency_key UK
        TSTZ    updated_at
        TSTZ    resuelto_at
    }

    INCIDENT_IMAGES {
        UUID    id PK
        UUID    incident_id FK
        TSTZ    incident_created_at FK
        VARCHAR image_url
        BOOL    es_principal
        TSTZ    created_at
    }

    STATUS_HISTORY {
        UUID    id PK
        UUID    incident_id FK
        TSTZ    incident_created_at FK
        ENUM    estado_anterior
        ENUM    estado_nuevo
        UUID    cambiado_por FK
        TEXT    observaciones
        ENUM    motivo_rechazo
        TSTZ    created_at
    }

    ASSIGNMENTS {
        UUID    id PK
        UUID    incident_id FK
        TSTZ    incident_created_at FK
        UUID    operario_id FK
        UUID    asignado_por FK
        TSTZ    fecha_esperada
        TEXT    notas
        BOOL    completada
        TSTZ    completada_at
        TSTZ    created_at
        TSTZ    updated_at
    }

    %% ── ai ───────────────────────────────────────────────────────────────────

    ANALYSIS_RESULTS {
        UUID    id PK
        UUID    incident_id FK-UK
        TSTZ    incident_created_at FK
        VARCHAR modelo_nombre
        VARCHAR modelo_version
        ENUM    tipo_residuo
        ENUM    nivel_acumulacion
        NUMERIC volumen_estimado_m3
        NUMERIC confianza
        JSONB   detecciones
        VARCHAR imagen_procesada_url
        INT     tiempo_inferencia_ms
        ENUM    nivel_acumulacion_supervisor
        ENUM    tipo_residuo_supervisor
        BOOL    ia_fue_correcta
        TEXT    nota_supervision
        UUID    supervisado_por FK
        TSTZ    supervisado_at
        TSTZ    created_at
    }

    ANALYSIS_FEEDBACK {
        UUID    id PK
        UUID    analysis_result_id FK
        BOOL    es_correcta
        TEXT    comentario
        UUID    reportado_por FK
        TSTZ    created_at
        TSTZ    updated_at
    }

    %% ── notifications ────────────────────────────────────────────────────────

    NOTIFICATIONS {
        UUID    id PK
        UUID    usuario_id FK
        UUID    incident_id FK
        TSTZ    incident_created_at FK
        VARCHAR titulo
        TEXT    mensaje
        ENUM    canal
        ENUM    estado
        INT     intentos
        TSTZ    proximo_intento_at
        TEXT    error_detalle
        TSTZ    leida_at
        TSTZ    enviada_at
        TSTZ    created_at
    }

    %% ── audit ────────────────────────────────────────────────────────────────

    AUDIT_LOG {
        BIGINT  id PK
        TSTZ    ocurrido_en PK
        UUID    actor_id
        INET    actor_ip
        VARCHAR accion
        TEXT    schema_name
        TEXT    table_name
        TEXT    row_pk
        JSONB   diff
    }

    %% ── Relaciones ───────────────────────────────────────────────────────────

    USERS ||--o{ REFRESH_TOKENS        : "tiene"
    USERS ||--o{ PASSWORD_RESET_TOKENS : "solicita"
    USERS ||--o{ USER_CONSENTS         : "acepta"
    USERS ||--o{ DEVICE_TOKENS         : "registra"
    USERS }o--o| ZONES                 : "asignado a"
    USERS ||--o{ INCIDENTS             : "reporta"
    USERS ||--o{ STATUS_HISTORY        : "cambia estado"
    USERS ||--o{ ASSIGNMENTS           : "asigna"
    USERS ||--o{ ASSIGNMENTS           : "recibe"
    USERS ||--o{ ANALYSIS_RESULTS      : "supervisa"
    USERS ||--o{ ANALYSIS_FEEDBACK     : "da feedback"
    USERS ||--o{ NOTIFICATIONS         : "recibe"
    USERS ||--o| ZONES                 : "supervisa zona"
    USERS ||--o{ INCIDENTS             : "etiqueta"

    ZONES ||--o{ INCIDENTS  : "contiene"

    INCIDENTS ||--o{ INCIDENT_IMAGES  : "tiene fotos"
    INCIDENTS ||--o{ STATUS_HISTORY   : "historial"
    INCIDENTS ||--o{ ASSIGNMENTS      : "asignaciones"
    INCIDENTS ||--o| ANALYSIS_RESULTS : "analizado por ML"
    INCIDENTS ||--o{ NOTIFICATIONS    : "genera"

    ANALYSIS_RESULTS ||--o{ ANALYSIS_FEEDBACK : "recibe feedback"
```

## Schemas y colores conceptuales

| Schema | Tablas | Propósito |
|---|---|---|
| `app_auth` | users, refresh_tokens, password_reset_tokens, pending_registrations, user_consents, device_tokens | Identidad, autenticación y sesiones |
| `operations` | zones, config | Zonas geográficas operativas y configuración |
| `incidents` | incidents*, incident_images, status_history, assignments | Ciclo de vida de incidentes de residuos |
| `ai` | analysis_results, analysis_feedback | Resultados y validación del modelo ML |
| `notifications` | notifications | Push y email hacia ciudadanos |
| `audit` | audit_log* | Trazabilidad LOPDP |

*Tablas particionadas por `RANGE(created_at)` mensual / anual

## Notas de diseño

- **`incidents.incidents`** tiene PK compuesta `(id, created_at)` requerida por el particionado mensual. Todas las tablas hijo referencian con FK compuesta.
- **`app_auth.users`** consolida desde migración 056 los perfiles que antes estaban en `public.ciudadanos` y `operations.operarios`.
- **`ai.analysis_results`** tiene columnas de supervisión aditivas: `nivel_acumulacion_supervisor` y `tipo_residuo_supervisor` nunca sobreescriben los valores originales del ML.
- Las **funciones** críticas son: `incidents.fn_assign_zone` (trigger de asignación GPS), `incidents.fn_notify_citizen` (push notifications no-abortivo), `app_auth.fn_revoke_previous_tokens` (race condition de tokens).
