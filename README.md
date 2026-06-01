# MIC EMASEO — Sistema de Gestión Inteligente de Residuos Urbanos

> **v4.0 — Sistema en producción** · Backend en Contabo + Supabase + Cloudflare R2 · Paneles en Cloudflare Pages · APK Android distribuible
>
> Plataforma de detección y gestión de acumulación de basura para **EMASEO EP** (Distrito Metropolitano de Quito, Ecuador).
> Los ciudadanos reportan mediante foto + GPS; la IA (RT-DETR-L v2) clasifica el nivel de acumulación y decide entre cuatro vías (válido / dudoso / rechazo confiable / error técnico); el supervisor revisa, corrige y asigna; el administrador gestiona zonas, personal y calidad del modelo.

---

## Sistema en producción

| Componente | URL | Tecnología |
|---|---|---|
| **API backend** | https://micemaseo.duckdns.org | Contabo VPS + Docker + Caddy + Let's Encrypt |
| **Panel supervisor** | https://mic-emaseo-panel.pages.dev | Cloudflare Pages (Vite build estático) |
| **Panel administrador** | https://mic-emaseo-admin.pages.dev | Cloudflare Pages (Vite build estático) |
| **APK móvil (Android)** | https://expo.dev/artifacts/eas/aYi21mysRrWCotkogndt2L.apk | React Native + Expo SDK 54 · canal `preview` |
| **Base de datos** | Supabase managed (región `sa-east-1`, São Paulo) | PostgreSQL 18 + PostGIS + pgcrypto |
| **Almacenamiento de imágenes** | Cloudflare R2 — bucket `emaseo-incidents` | S3-compatible |
| **DNS** | DuckDNS — `micemaseo.duckdns.org` (cron de auto-update en el VPS) | Free dynamic DNS |
| **ERD base de datos** | [`ERD.png`](ERD.png) en la raíz del repo | Diagrama entidad-relación completo |

**Costo mensual operativo:** ~$5.40 USD (solo Contabo VPS 10). Supabase, R2, Pages, DuckDNS y EAS están dentro de planes gratuitos.

> **Sobre los dos schemas `auth` en Supabase:**
> Al abrir el proyecto en pgAdmin o en el dashboard de Supabase se ven **dos** schemas de autenticación:
> - **`auth`** — es el sistema GoTrue de Supabase (viene en *todo* proyecto Supabase, no se puede eliminar). **Este proyecto NO lo usa.**
> - **`app_auth`** — es el sistema de autenticación construido a medida para este proyecto: JWT propio, roles CIUDADANO/OPERARIO/SUPERVISOR/ADMIN, refresh tokens, OTP, auditoría LOPDP.
>
> El sistema se apoya en Supabase **únicamente como motor PostgreSQL + PostGIS**; no usa Supabase Auth, Data API ni Realtime.

---

## Índice

1. [Características principales](#1-características-principales)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura — desarrollo y producción](#3-arquitectura--desarrollo-y-producción)
4. [Microservicios backend](#4-microservicios-backend)
5. [Modelo de Machine Learning y pipeline de decisión](#5-modelo-de-machine-learning-y-pipeline-de-decisión)
6. [Frontend — app móvil y paneles web](#6-frontend--app-móvil-y-paneles-web)
7. [Esquema de base de datos](#7-esquema-de-base-de-datos)
8. [Seguridad](#8-seguridad)
9. [Infraestructura Docker](#9-infraestructura-docker)
10. [Inicio rápido — desarrollo local](#10-inicio-rápido--desarrollo-local)
11. [Despliegue en producción](#11-despliegue-en-producción)
12. [Variables de entorno](#12-variables-de-entorno)
13. [Flujos principales](#13-flujos-principales)
14. [Usuarios de prueba](#14-usuarios-de-prueba)
15. [Estructura del proyecto](#15-estructura-del-proyecto)
16. [Migraciones y cambios destacables](#16-migraciones-y-cambios-destacables)
17. [Licencia y créditos](#17-licencia-y-créditos)

---

## 1. Características principales

### Ciudadano (app móvil)
- **Reporte con foto + GPS** — Captura imagen y coordenadas en un gesto; permisos secuenciales; cola offline FIFO con backoff exponencial al recuperar conectividad.
- **Pre-check de basura** — Thumbnail ~15 KB a `/ml/pre-check` antes del upload completo; fail-closed (si la red falla, no se asume positivo).
- **Recorte al overlay de escaneo** — `expo-image-manipulator` recorta exactamente al recuadro visible; recorte + GPS se capturan en paralelo.
- **Guía de distancia en tiempo real** — Frame processor VisionCamera a 5 fps estima profundidad (MiDaS proxy) y muestra barra TOO_CLOSE / OPTIMAL / TOO_FAR.
- **Historial con polling** — Auto-sondeo cada 5 s mientras haya incidentes en `PROCESANDO`; `task_id` persiste en AsyncStorage si el usuario cierra la pantalla.
- **Notificaciones reales** — `AlertsScreen` consume `notifications.notifications` vía `/incidents/notifications`; optimistic mark-read y mark-all-read.
- **Pantalla de ayuda** — `HelpScreen` explica los 7 estados del reporte (PROCESANDO/PENDIENTE/EN_REVISION/EN_ATENCION/RESUELTA/RECHAZADA/DESCARTADO) + 5 FAQ.
- **Sesión persistente** — Refresh silencioso al arrancar la app; no pide login si el refresh token (7 días) sigue válido.
- **Tooltips en ScanResult** — Íconos ⓘ con explicación de Detecciones, Confianza, Prioridad y MIXTO; cobertura oculta cuando es nula; sin tiempo de inferencia.

### Supervisor (panel web)
- **Wizard de 3 pasos** — Validar reporte → Firmar veredicto IA → Asignar operario.
- **Corrección supervisada estructurada** — `ia_fue_correcta`, `nivel_acumulacion_supervisor`, `tipo_residuo_supervisor` preservan el dato ML original.
- **Geocerca de cierre** — Al marcar RESUELTA, el browser captura GPS del supervisor; el backend calcula `ST_Distance` y rechaza si supera la tolerancia configurada (default 10 m).
- **Cambio de contraseña** desde Configuración del panel.

### Administrador (panel web — nuevo en v4.0)
- **Gestión de supervisores** — CRUD completo: crear (con contraseña temporal autogenerada), editar nombre/teléfono/estado, desactivar.
- **Gestión de zonas PostGIS** — Mapa Leaflet con polígonos, importador GeoJSON (Polygon/MultiPolygon), asignación de supervisor por zona.
- **Dashboard analítico** — KPIs en tiempo real (pendientes/en revisión/asignados/resueltos hoy), tabla de estadísticas por zona (últimos 30 días), top 5 críticos.
- **Calidad del modelo IA** — Precisión global con barra de color, errores por tipo de residuo y nivel de acumulación, últimas 25 correcciones, exportación del dataset de reentrenamiento en JSON.
- **Auditoría de imágenes R2** — Grid paginado de imágenes con overlay ML; etiquetado VÁLIDA / DUDOSA / EXCLUIR / PENDIENTE por imagen para curar el dataset.
- **Configuración** — Tolerancia de geocerca (editable, persiste en `operations.config`), cambio de contraseña del admin.

### Sistema
- **Pipeline de decisión en 4 vías** — `INCIDENTE_VALIDO` → PENDIENTE, `REVISION_REQUERIDA` → EN_REVISION, `RECHAZO_CONFIABLE` → DESCARTADO, `ERROR_TECNICO` → FALLIDO.
- **Auditoría completa** — Auth events (LOGIN/CHANGE_PASSWORD/RESET_PASSWORD) en `audit.audit_log` con actor_ip y user_agent; triggers en INSERT/UPDATE/DELETE de tablas críticas.
- **Circuit Breaker (opossum)** sobre el ML Service.
- **Asignación automática por zona** — PostGIS `ST_Covers` via trigger al insertar/actualizar ubicación.
- **Rate limiting granular** — login 5/15min · OTP 10/15min · imagen 20/h · forgot-password 5/h · global 100/15min.
- **Anti-enumeración** — Login devuelve mensaje genérico para email inexistente y password errónea.
- **HTTPS automático** — Caddy + Let's Encrypt; HSTS activo.

---

## 2. Stack tecnológico

| Capa | Tecnología | Versión / nota |
|---|---|---|
| API Gateway | Node.js + Express + Helmet + pino + http-proxy-middleware | Node 22 |
| Auth Service | Node.js + Express + bcryptjs + nodemailer + pg | Node 22 |
| Users Service | Node.js + Express + pg | Node 22 |
| Image Service | Node.js + Express + AWS SDK v3 + opossum (CB) + sharp + pg | Node 22 |
| ML API | Python + FastAPI + Gunicorn + Uvicorn workers | Python 3.11 |
| ML Worker | Celery + Ultralytics 8.3.x (RT-DETR) | Python 3.11 |
| Base de datos (dev) | PostgreSQL 16 + PostGIS 3.4 + pgcrypto | Docker `postgis/postgis:16-3.4` |
| Base de datos (prod) | PostgreSQL 17 + PostGIS + pgcrypto | Supabase managed (sa-east-1) |
| Object storage (dev) | MinIO | Docker |
| Object storage (prod) | Cloudflare R2 | S3-compatible |
| Message broker | Redis 7 (requirepass) | Docker |
| Reverse proxy (prod) | Caddy 2.11 + Let's Encrypt | apt package |
| App móvil | React Native + Expo SDK 54 + TypeScript + VisionCamera | EAS Build |
| Panel supervisor | React 19 + Vite 8 + TypeScript + Tailwind 4 + React Leaflet | Cloudflare Pages |
| Panel administrador | React 19 + Vite 8 + TypeScript + Tailwind 4 + React Leaflet | Cloudflare Pages |
| Modelo IA | RT-DETR-L v2 (`rtdetr_l_best.pt`) — 32.8 M params, 63 MB | Entrenado en Colab T4 |
| Documentación API | swagger-jsdoc + swagger-ui-express | `/api-docs` |
| Logs | pino (JSON estructurado) | Campos sensibles → `[REDACTED]` |
| CI/CD | GitHub Actions — lint + typecheck + build + Docker push a GHCR | `.github/workflows/ci.yml` |

---

## 3. Arquitectura — desarrollo y producción

### 3.1 Desarrollo local (Docker Compose)

Todo corre en un solo `docker compose up -d`. PostgreSQL, MinIO, Redis y todos los microservicios están dentro de la misma red bridge `emaseo_network`. Solo el API Gateway (puerto 4000) se publica al host. Los paneles web corren con `npm run dev` fuera de Docker (puerto 5173).

```
Cliente móvil ──┐
Panel web ───────┼──► API Gateway :4000 ──┬──► Auth :3002 ────► PostgreSQL :5432
Panel admin ─────┘    (Helmet + JWT +     ├──► Users :3000 ───►   (PostGIS)
                       Rate Limit +       ├──► Image :5000 ───┬─► MinIO :9000
                       RBAC + Swagger)    │                   └─► Redis :6379
                                          └──► ML API :8000 ──► ML Worker (Celery)
```

### 3.2 Producción (cloud distribuido)

```
┌──────────────┐  ┌───────────────────────────┐  ┌──────────────────────────────┐
│ 📱 APK       │  │ 🌐 Panel supervisor        │  │ 🔐 Panel administrador       │
│ Android      │  │ mic-emaseo-panel.pages.dev │  │ mic-emaseo-admin.pages.dev   │
│ (EAS Build)  │  │ Cloudflare Pages           │  │ Cloudflare Pages             │
└──────┬───────┘  └─────────────┬──────────────┘  └───────────────┬──────────────┘
       │                        │  HTTPS + CORS                   │  HTTPS + CORS
       └────────────────────────┼─────────────────────────────────┘
                                ▼
        ┌───────────────────────────────────────────────────────┐
        │        Caddy :443  ──►  Let's Encrypt cert            │
        │        micemaseo.duckdns.org  (DuckDNS A record)      │
        │        VPS Contabo Cloud VPS 10 (Ubuntu 22.04)        │
        └──────────────────────┬────────────────────────────────┘
                               │  reverse_proxy 127.0.0.1:4000
                               ▼
        ┌───────────────────────────────────────────────────────┐
        │  Docker Compose (network IPv4 + IPv6)                 │
        │  ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
        │  │ Gateway  │─│  Auth  │ │ Users  │ │ Image  │       │
        │  │  :4000   │ │ :3002  │ │ :3000  │ │ :5000  │       │
        │  └──────────┘ └───┬────┘ └───┬────┘ └───┬────┘       │
        │                   └──────────┴───────────┘            │
        │                             │ pg IPv6 directo         │
        │                             ▼                         │
        │          Supabase db.<ref>.supabase.co :5432          │
        │          PostgreSQL 17 + PostGIS + pgcrypto           │
        │          Schema: app_auth (renombrado, evita colisión) │
        │                                                       │
        │  ┌──────────┐  ┌─────────────┐  ┌────────┐           │
        │  │ ML API   │  │ ML Worker   │  │ Redis  │           │
        │  └────┬─────┘  └─────────────┘  └────────┘           │
        │       │ S3 SDK → Cloudflare R2 (emaseo-incidents)     │
        └───────────────────────────────────────────────────────┘
```

**Decisiones técnicas clave:**

- **Schema `app_auth`** — Supabase reserva `auth` para gotrue. Nuestro schema se renombró a `app_auth` para evitar colisión. Los 9 archivos backend afectados se actualizaron (commit `159d45b`).
- **Conexión directa IPv6 (puerto 5432)** — El pooler Supavisor no reconoce roles personalizados (`auth_svc`, etc.). La conexión directa sí los acepta.
- **Docker IPv6 habilitado** — `/etc/docker/daemon.json` con `"ipv6": true, "ip6tables": true`.
- **`search_path` por rol** — `ALTER ROLE <rol> SET search_path = public, extensions, "$user"` para acceder a `crypt()`, `gen_salt()`, `uuid_generate_v4()` del schema `extensions` de Supabase.
- **CORS adaptivo** — Orígenes en `CORS_ORIGINS` (env); adicionalmente `localhost:*` siempre permitido para desarrollo local contra producción.
- **No usamos Supabase Auth ni Data API** — Supabase es solo Postgres + PostGIS.

---

## 4. Microservicios backend

### API Gateway `:4000`

- Proxy a microservicios con `http-proxy-middleware`.
- Validación de JWT (access token, 15 min) antes de reenviar.
- RBAC: `requireCiudadano`, `requireStaff`, `requireSupervisor`, `requireAdmin`.
- Rate limiting granular por endpoint.
- Inyecta `X-Internal-Token` en cada petición upstream; 403 si falta.
- Swagger UI en `/api-docs`.
- `localhost:*` siempre permitido en CORS para desarrollo.

### Auth Service `:3002`

| Endpoint | Descripción |
|---|---|
| `POST /api/auth/login` | Access token (15 min) + refresh token (7 días). Anti-enumeración. Registra evento en `audit.audit_log`. |
| `POST /api/auth/refresh` | Rotación de refresh token. |
| `POST /api/auth/logout` | Revoca refresh token. |
| `POST /api/auth/change-password` | Cambia contraseña con JWT válido. Registra en `audit.audit_log` con IP y user-agent. |
| `POST /api/auth/forgot-password` | OTP 6 dígitos (bcrypt, TTL 15 min) por email. |
| `POST /api/auth/verify-reset-otp` | Valida OTP hasheado. |
| `POST /api/auth/reset-password` | Actualiza contraseña atómicamente + devuelve JWT. Registra en audit. |
| `POST /api/auth/register` | Paso 1 — `pending_registrations` + OTP. |
| `POST /api/auth/verify-otp` | Paso 2 — valida OTP de registro. |
| `POST /api/auth/set-password` | Paso 3 — INSERT usuarios + consentimiento LOPDP. |

**Auditoría de autenticación:** los eventos LOGIN, CHANGE_PASSWORD y RESET_PASSWORD se insertan en `audit.audit_log` con `actor_id`, `actor_ip` (de `x-forwarded-for`), acción y `user_agent`. No bloquea el flujo si el insert falla.

### Users Service `:3000`

**Supervisores (requiere rol ADMIN via gateway):**

| Endpoint | Descripción |
|---|---|
| `GET /api/users/supervisores` | Lista supervisores activos con zona asignada. |
| `GET /api/users/supervisores/:id` | Detalle de un supervisor. |
| `POST /api/users/supervisores` | Crea supervisor; genera contraseña temporal si no se provee. |
| `PUT /api/users/supervisores/:id` | Edita nombre, teléfono, estado (ACTIVO/INACTIVO/SUSPENDIDO). |
| `DELETE /api/users/supervisores/:id` | Soft-delete (estado → INACTIVO). |

**Zonas PostGIS (requiere rol ADMIN):**

| Endpoint | Descripción |
|---|---|
| `GET /api/users/zonas` | Lista zonas con geometría GeoJSON y supervisor asignado. |
| `PUT /api/users/zonas/:id` | Actualiza nombre, descripción, supervisor_id, activa. Soporta desasignar supervisor (supervisor_id: null). |
| `POST /api/users/zonas/import` | Importa array de Features GeoJSON (Polygon/MultiPolygon). UPSERT por `codigo`. |

**Configuración del sistema (requiere rol ADMIN):**

| Endpoint | Descripción |
|---|---|
| `GET /api/users/config/:clave` | Lee valor de configuración. Ej: `geofence_tolerancia_m`. |
| `PUT /api/users/config/:clave` | Escribe/actualiza valor de configuración (UPSERT). |

### Image Service `:5000`

Orquestador del flujo de reporte. Implementa la máquina de estados de 4 decisiones (migración 032).

```
1. Validación (sharp): magic bytes JPEG/PNG · dimensiones ≥ 320×320 · tamaño ≥ 1 KB
2. INSERT incidents estado=PROCESANDO → 202 { task_id, poll_url }
3. [Celery background]
   → Circuit Breaker → POST ml-api:8000/predict
   INCIDENTE_VALIDO   → estado=PENDIENTE   (imagen + analysis_results)
   REVISION_REQUERIDA → estado=EN_REVISION (imagen preservada)
   RECHAZO_CONFIABLE  → estado=DESCARTADO  (imagen preservada)
   ERROR_TECNICO      → estado=FALLIDO     (imagen preservada)
4. GET /api/image/status/:task_id → polling con backoff 500 ms → 8 s
```

**Recovery:** cada 30 s revisa PROCESANDO > 3 min y reintenta tarea Celery.

**Endpoints supervisores** (`/api/supervisor/*`, roles SUPERVISOR y ADMIN):

| Endpoint | Descripción |
|---|---|
| `GET /supervisor/incidents` | Lista paginada con filtros: estado, prioridad, zona_id, decision_automatica, fechas, ia_incorrecta, sin_supervisar. |
| `GET /supervisor/incidents/:id` | Detalle + historial + asignaciones + feedback IA. |
| `PUT /supervisor/incidents/:id/estado` | FSM validada. Al pasar a **RESUELTA** requiere `cierre_lat` + `cierre_lon`; valida geocerca contra `operations.config.geofence_tolerancia_m`. |
| `POST /supervisor/incidents/:id/asignar` | Asigna operario. |
| `PUT /supervisor/incidents/:id/revision-ia` | Veredicto IA: `es_correcta_ia`, correcciones `*_supervisor`, nota. Idempotente. |
| `GET /supervisor/operarios` | Lista operarios activos para dropdown. |
| `GET /supervisor/zonas/mapa` | GeoJSON con zonas + incidentes activos. |
| `GET /supervisor/zonas/estadisticas` | Estadísticas por zona (últimos 30 días). |

**Endpoints IA / calidad del modelo** (`/api/supervisor/ia/*`):

| Endpoint | Descripción |
|---|---|
| `GET /supervisor/ia/estadisticas` | Métricas: total, supervisados, correctos, incorrectos, pendientes, % precisión, errores por tipo/nivel, últimas 25 correcciones. |
| `GET /supervisor/ia/dataset` | Exporta JSON con todos los análisis supervisados para reentrenamiento del modelo. |
| `GET /supervisor/ia/imagenes` | Grid paginado de imágenes con resultado ML y etiqueta de auditoría. Filtros: `etiqueta`, `ia_correcta`. |
| `PUT /supervisor/ia/imagenes/:incident_id/etiqueta` | Asigna etiqueta de auditoría (PENDIENTE / VALIDA_ENTRENAMIENTO / DUDOSA / EXCLUIR). UPSERT. |

**Endpoints notificaciones ciudadano** (`/api/incidents/*`):

| Endpoint | Descripción |
|---|---|
| `GET /incidents/me` | Historial de incidentes del ciudadano autenticado. |
| `GET /incidents/notifications` | Notificaciones reales del ciudadano (últimas 50). |
| `PUT /incidents/notifications/:id/read` | Marca una notificación como leída. |
| `PUT /incidents/notifications/read-all` | Marca todas como leídas. |

### ML Service `:8000`

FastAPI + Gunicorn (4 workers) + Celery worker. Detalles en sección 5.

---

## 5. Modelo de Machine Learning y pipeline de decisión

**Pesos:** `ML/modelos/rtdetr_l_best.pt` (RT-DETR-L v2, 63 MB, 32.8 M params)
**Framework:** FastAPI + Ultralytics 8.3 + Celery + Redis

### 5.1 Métricas (v1 → v2)

| Métrica | v1 (CPU, dataset 12 k) | v2 (GPU T4, dataset 22 k) | Mejora |
|---|---|---|---|
| mAP@50 | 0.4752 | **0.8802** | +85.2% |
| mAP@50:95 | 0.2450 | **0.6069** | +147.7% |
| Precision | 0.5523 | **0.8840** | +60.1% |
| Recall | 0.4353 | **0.8203** | +88.5% |

Best epoch 64/100, AdamW, `lr0=0.0001`, batch=16, cosine annealing, augmentation Mosaic + HSV + Erasing + CopyPaste 0.1.

### 5.2 Dataset — 21 987 train + 3 531 val (1 clase: `garbage`)

| Fuente | Tipo | Aporte |
|---|---|---|
| Garbage Collector v8 (Roboflow) | YOLO | Base principal |
| TACO (pedropro/TACO) | COCO → YOLO | Imágenes de campo reales |
| Garbage Detection (Roboflow) | YOLO | Variedad de escenas |
| Street Trash (Roboflow) | YOLO | Basura en vía pública |
| 501 negativas de Quito | YOLO (sin etiquetas) | Background — reduce falsos positivos |

### 5.3 Pipeline de inferencia

```
Imagen base64 → PIL → resize 640×640
├── /ml/pre-check (opcional): garbage_score, is_garbage, threshold  ← thumbnail ~15 KB
└── /predict (Celery):
    → RTDETR.predict(conf=0.35, iou=0.50)
    → Filtro whitelist de clases + filtro área < 0.5% (ruido)
    ├─ Sin detecciones → RECHAZO_CONFIABLE → DESCARTADO
    └─ Con detecciones → coverage_ratio + effective_ratio:
       effective_ratio = coverage_ratio × conf_factor × det_factor
                        × class_weight × ISOLATION_PENALTY × scale_penalty
```

### 5.4 Bandas de clasificación

| `effective_ratio` | Nivel | Prioridad | Volumen estimado |
|---|---|---|---|
| 0.00 – 0.15 | BAJO | BAJA | 0.1 – 0.5 m³ |
| 0.15 – 0.40 | MEDIO | MEDIA | 0.5 – 2.0 m³ |
| 0.40 – 0.70 | ALTO | ALTA | 2.0 – 5.0 m³ |
| 0.70 – 1.00 | CRÍTICO | CRÍTICA | 5.0 – 15.0 m³ |

### 5.5 Las cuatro decisiones automáticas

| `decision_automatica` | Estado final | Significado |
|---|---|---|
| `INCIDENTE_VALIDO` | PENDIENTE | Detecciones con buena confianza |
| `REVISION_REQUERIDA` | EN_REVISION | Confianza ambigua — supervisor decide |
| `RECHAZO_CONFIABLE` | DESCARTADO | Sin detecciones, imagen preservada |
| `ERROR_TECNICO` | FALLIDO | Fallo de inferencia, imagen preservada |

### 5.6 Corrección supervisada y dataset de reentrenamiento

Las columnas `*_supervisor` en `ai.analysis_results` son **aditivas** — el dato ML original no se modifica. El administrador puede exportar todos los análisis supervisados en JSON desde `/supervisor/ia/dataset` y etiquetar imágenes individualmente desde `/supervisor/ia/imagenes` para curar el dataset de reentrenamiento.

---

## 6. Frontend — app móvil y paneles web

### 6.1 App móvil — `Frontend/smart-waste-mobile/`

**Stack:** React Native + Expo SDK 54 + TypeScript + VisionCamera + expo-image-manipulator + SecureStore.

| Pantalla | Función |
|---|---|
| `LoginScreen` / `RegisterScreen` | Wizard de 3 pasos: datos → OTP email → contraseña |
| `ForgotPasswordScreen` / `ResetPasswordScreen` | Recuperación OTP 3 pasos; login automático al completar |
| `ScanScreen` | Cámara VisionCamera + overlay + GPS en paralelo + recorte real al overlay |
| `ScanResultScreen` | Nivel, volumen, tipo, confianza; tooltips ⓘ en métricas IA; cobertura condicional |
| `HistorialScreen` | Lista con auto-polling mientras haya PROCESANDO; estado vacío amigable |
| `ReportDetailScreen` | Mapa + geocoding inverso + foto desde R2 |
| `AlertsScreen` | Notificaciones reales de la BD; pull-to-refresh; mark-as-read optimista |
| `HelpScreen` | 7 acordeones de estados + 5 FAQ en lenguaje cotidiano |

**Particularidades técnicas:**
- Tokens en **SecureStore** (cifrado del dispositivo).
- Refresh silencioso al arrancar — si el access token expiró pero el refresh token (7 días) sigue válido, se renueva sin pedir login.
- Pre-check fail-closed: si el pre-check falla por red, NO se asume optimista.
- Cola offline FIFO con backoff exponencial en `offlineQueue.service.ts`.

### 6.2 Panel supervisor — `Frontend/supervisor-panel/`

**Stack:** React 19 + Vite 8 + Tailwind 4 + React Leaflet.
**Despliegue:** Cloudflare Pages. `VITE_API_URL=https://micemaseo.duckdns.org/api npm run build`.

**Layout tablet-first** — Sidebar colapsable 80 ↔ 224 px.

**Wizard de 3 pasos:**
```
Step1Validate  → ¿Es un reporte real? → Validar o Rechazar
Step2Classify  → Firmar veredicto IA + correcciones + nota
Step3Assign    → Seleccionar operario; al marcar RESUELTA:
                   browser captura GPS → backend valida geocerca
                   Si distancia > tolerancia: el cierre es rechazado
                   Si OK: guarda cierre_lat/lon/distancia_m
```

### 6.3 Panel administrador — `Frontend/admin-panel/` *(nuevo en v4.0)*

**Stack:** React 19 + Vite 8 + Tailwind 4 + React Leaflet.
**Despliegue:** Cloudflare Pages. URL: https://mic-emaseo-admin.pages.dev
**Acceso:** exclusivo rol ADMIN. Tokens aislados en `admin_token` (no colisiona con supervisor-panel).

| Página | Ruta | Funcionalidad |
|---|---|---|
| Inicio | `/dashboard/home` | KPIs en tiempo real, tabla de estadísticas por zona, top 5 críticos |
| Supervisores | `/dashboard/supervisores` | CRUD completo; tabla filtrable; contraseña temporal al crear |
| Zonas | `/dashboard/zonas` | Mapa Leaflet + lista + editor + importador GeoJSON |
| Modelo IA | `/dashboard/ia` | Precisión global, errores por tipo/nivel, exportar dataset |
| Auditoría R2 | `/dashboard/auditoria` | Grid de imágenes, etiquetado para reentrenamiento, filtros |
| Configuración | `/dashboard/configuracion` | Tolerancia geocerca, cambio de contraseña, info sistema |

---

## 7. Esquema de base de datos

**Motor dev:** PostgreSQL 16 + PostGIS 3.4 + pgcrypto (Docker).
**Motor prod:** PostgreSQL 18 + PostGIS + pgcrypto (Supabase managed, sa-east-1).

### 7.1 Schemas

| Schema | Tablas principales |
|---|---|
| `app_auth` | `users`, `refresh_tokens`, `password_reset_tokens`, `pending_registrations`, `device_tokens`, `user_consents` |
| `public` | `ciudadanos` (perfil 1:1) |
| `operations` | `operarios`, `zones` (PostGIS EPSG:4326), **`config`** (clave-valor del sistema) |
| `incidents` | `incidents`, `incident_images`, `status_history`, `assignments` |
| `ai` | `analysis_results` (JSONB detecciones + correcciones supervisor), `analysis_feedback`, **`image_audit`** |
| `notifications` | `notifications` |
| `audit` | `audit_log` particionado mensual |

### 7.2 Columnas destacables añadidas en v4.0

**`incidents.incidents`** (migración 038):
```sql
cierre_lat         DOUBLE PRECISION   -- latitud GPS del operario al cerrar
cierre_lon         DOUBLE PRECISION   -- longitud GPS del operario al cerrar
cierre_foto_url    TEXT               -- foto de evidencia de cierre (futuro)
cierre_distancia_m NUMERIC(8,2)       -- distancia calculada al punto reportado
```

**`operations.config`** (migración 037):
```sql
clave       VARCHAR(100) PRIMARY KEY   -- ej: 'geofence_tolerancia_m'
valor       TEXT NOT NULL              -- ej: '10'
descripcion TEXT
updated_at  TIMESTAMPTZ
```
Valor inicial: `geofence_tolerancia_m = 10` (metros).

**`ai.image_audit`** (migración 039):
```sql
incident_id     UUID UNIQUE FK → incidents.incidents
etiqueta        ai.image_audit_label  -- PENDIENTE | VALIDA_ENTRENAMIENTO | DUDOSA | EXCLUIR
comentario      TEXT
etiquetado_por  UUID FK → app_auth.users
etiquetado_at   TIMESTAMPTZ
```

**`ai.analysis_results`** (migración 033 — ya existente):
```sql
ia_fue_correcta              BOOLEAN    -- veredicto supervisor
nivel_acumulacion_supervisor ai.accumulation_level
tipo_residuo_supervisor      ai.waste_type
nota_supervision             TEXT
supervisado_por              UUID FK
supervisado_at               TIMESTAMPTZ
```

### 7.3 ENUMs clave

```sql
app_auth.user_role         : CIUDADANO | OPERARIO | SUPERVISOR | ADMIN
app_auth.user_status       : ACTIVO | INACTIVO | SUSPENDIDO
incidents.incident_status  : PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA
                             | PROCESANDO | FALLIDO | EN_REVISION | DESCARTADO
ai.image_audit_label       : PENDIENTE | VALIDA_ENTRENAMIENTO | DUDOSA | EXCLUIR
```

### 7.4 Índices destacables

```sql
-- Geoespaciales
CREATE INDEX idx_incidents_ubicacion_gist ON incidents.incidents USING gist (ubicacion);
CREATE INDEX idx_zones_geom_gist          ON operations.zones     USING gist (geom);

-- Detecciones JSON (GIN)
CREATE INDEX idx_ai_detecciones_gin ON ai.analysis_results USING gin (detecciones);

-- Auditoría IA
CREATE INDEX idx_ai_ia_incorrecta      ON ai.analysis_results (supervisado_at DESC)
   WHERE ia_fue_correcta = FALSE;
CREATE INDEX idx_ai_pendiente_revision ON ai.analysis_results (created_at DESC)
   WHERE supervisado_por IS NULL;

-- Image audit
CREATE INDEX idx_image_audit_etiqueta  ON ai.image_audit (etiqueta);
```

### 7.5 Triggers y funciones

- `incidents.fn_assign_zone` — BEFORE INSERT/UPDATE de `ubicacion`, asigna la zona más específica con `ST_Covers + ORDER BY ST_Area ASC`.
- `incidents.fn_log_status_change` — BEFORE UPDATE de `estado`, inserta en `status_history`; setea `resuelto_at` al pasar a RESUELTA.
- `incidents.fn_notify_citizen` — AFTER UPDATE de `estado`, inserta notificaciones para PENDIENTE, EN_ATENCION, RESUELTA, RECHAZADA, DESCARTADO.
- `audit.fn_audit_trigger` — SECURITY DEFINER, captura `actor_id` y `actor_ip` desde `current_setting` para INSERT/UPDATE/DELETE en tablas críticas.
- `public.fn_validar_cedula_ec` — algoritmo Módulo 10 del Registro Civil ecuatoriano.

### 7.6 Roles de mínimo privilegio

| Rol | Permisos |
|---|---|
| `auth_svc` | RW en `app_auth.*`, SELECT en `public.ciudadanos`, SELECT en `operations.operarios` |
| `users_svc` | RW en `public.*`, RW en `operations.*` (incluye `config`), SELECT/INSERT/UPDATE en `app_auth.users` |
| `image_svc` | RW en `incidents.*` y `ai.*` (incluye `image_audit`), SELECT/UPDATE en `notifications.notifications`, SELECT en `operations.config`, SELECT en `app_auth.users` / `public.ciudadanos` / `operations.zones` / `operations.operarios` |

> **Nota RLS Supabase:** las tablas nuevas (`operations.config`, `ai.image_audit`) requieren `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` después de crearlas, ya que Supabase las activa por defecto y los roles de servicio no pueden escribir sin una política explícita.

---

## 8. Seguridad

| Capa | Medida |
|---|---|
| **Red** | Solo Caddy expone 80/443 (UFW). Gateway escucha en `127.0.0.1:4000`. Demás contenedores sin puertos al host. |
| **TLS** | Caddy + Let's Encrypt. HSTS + Strict-Transport-Security activos. |
| **Autenticación** | JWT (15 min) + refresh token rotatorio (7 días, SHA-256 en DB). |
| **Contraseñas** | bcrypt cost 12 (prod). Reglas: 8+ chars, mayúscula, minúscula, dígito. |
| **Anti-enumeración** | Mensaje genérico para email inexistente vs password errónea. |
| **OTP** | 6 dígitos, bcrypt en DB, TTL 15 min, un solo uso. |
| **Auditoría auth** | LOGIN, CHANGE_PASSWORD, RESET_PASSWORD → `audit.audit_log` con actor_ip y user_agent. |
| **Comunicación interna** | `X-Internal-Token` en cada petición upstream; 403 si falta. |
| **CORS** | Origins en `CORS_ORIGINS` (env) + `localhost:*` siempre permitido para dev. |
| **Rate limiting** | Granular por endpoint. |
| **Validación imágenes** | sharp: magic bytes JPEG/PNG, dimensiones mínimas, anti-polyglot. |
| **Geocerca de cierre** | `ST_Distance` entre ubicación del incidente y GPS del supervisor; rechaza si > `geofence_tolerancia_m`. |
| **DB mínimo privilegio** | Tres roles separados con GRANTs específicos. |
| **Móvil** | Tokens en SecureStore. Pre-check fail-closed. |
| **Logs** | pino JSON. Campos `password/token/otp/refreshToken` → `[REDACTED]`. |
| **Circuit Breaker** | opossum sobre el ML Service (50% errores / ventana 60 s). |

---

## 9. Infraestructura Docker

### `docker-compose.yml` (desarrollo)

| Contenedor | Imagen | Puerto host |
|---|---|---|
| `emaseo-postgres` | `postgis/postgis:16-3.4` | 5432 |
| `emaseo-minio` | `minio/minio:latest` | 9000 (+9001 con `-Dev`) |
| `emaseo-redis` | `redis:7-alpine` | (interno) |
| `emaseo-auth` | Build `./Backend/auth-service` | (interno) |
| `emaseo-users` | Build `./Backend/users-service` | (interno) |
| `emaseo-image` | Build `./Backend/image-service` | (interno) |
| `emaseo-gateway` | Build `./Backend/api-gateway` | **4000** |
| `emaseo-ml-api` | Build `./Backend/ml-service` | (interno) |
| `emaseo-ml-worker` | Build `./Backend/ml-service` | (interno) |
| `emaseo-flower` | `mher/flower:2.0` | 5555 (solo `-Dev`) |

### `docker-compose.prod.yml`

Sin Postgres ni MinIO (managed en Supabase y R2). Solo el Gateway publica puerto (`127.0.0.1:4000`). Network con IPv6 habilitado para conectar a Supabase. Imágenes de `ghcr.io/jsmena5/<servicio>:latest` (build como fallback).

---

## 10. Inicio rápido — desarrollo local

### ① Backend completo

**Windows (PowerShell):**
```powershell
.\start.ps1           # genera .env, construye y levanta contenedores
.\start.ps1 -NoBuild  # arranque rápido (imágenes ya construidas)
.\start.ps1 -Dev      # expone MinIO :9001, Redis :6379, Flower :5555
```

**Linux / macOS:**
```bash
bash start.sh
bash start.sh --no-build
bash start.sh --dev
```

### ② Panel supervisor (dev)

```bash
cd Frontend/supervisor-panel
npm install
npm run dev   # → http://localhost:5173
```
`.env.development`: `VITE_API_URL=http://localhost:4000/api`

### ③ Panel administrador (dev)

```bash
cd Frontend/admin-panel
npm install
npm run dev   # → http://localhost:5174
```
`.env.development` incluye proxy automático vía `VITE_PROXY_TARGET`:
```env
VITE_API_URL=http://localhost:4000/api
# Para apuntar al backend de producción sin CORS:
# VITE_API_URL=/api
# VITE_PROXY_TARGET=https://micemaseo.duckdns.org
```

### ④ App móvil (Expo)

```bash
cd Frontend/smart-waste-mobile
npm install
npx expo start
```
`.env.development`: `EXPO_PUBLIC_API_URL=http://<IP-LAN>:4000/api`

### URLs útiles en dev

| Servicio | URL |
|---|---|
| API Gateway | `http://localhost:4000` |
| Swagger UI | `http://localhost:4000/api-docs` |
| Panel supervisor | `http://localhost:5173` |
| Panel administrador | `http://localhost:5174` |
| MinIO Console | `http://localhost:9001` (con `-Dev`) |
| Flower (Celery) | `http://localhost:5555` (con `-Dev`) |

---

## 11. Despliegue en producción

### 11.1 Supabase (PostgreSQL managed)

1. Crear proyecto región **sa-east-1** (São Paulo). Desactivar Data API y RLS.
2. Aplicar migraciones en orden en el SQL Editor (01 → 039).
3. Ejecutar script 012 con passwords reales.
4. Configurar search_path por rol:
   ```sql
   ALTER ROLE auth_svc  SET search_path = public, extensions, "$user";
   ALTER ROLE users_svc SET search_path = public, extensions, "$user";
   ALTER ROLE image_svc SET search_path = public, extensions, "$user";
   GRANT USAGE ON SCHEMA extensions TO auth_svc, users_svc, image_svc;
   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO auth_svc, users_svc, image_svc;
   ```
5. Deshabilitar RLS en tablas de sistema:
   ```sql
   ALTER TABLE operations.config   DISABLE ROW LEVEL SECURITY;
   ALTER TABLE ai.image_audit      DISABLE ROW LEVEL SECURITY;
   ```
6. Crear usuario ADMIN:
   ```sql
   INSERT INTO app_auth.users (username, email, password_hash, rol, estado)
   VALUES ('admin', 'admin@emaseo.gob.ec',
           crypt('ContraseñaSegura123!', gen_salt('bf', 12)), 'ADMIN', 'ACTIVO');
   ```

### 11.2 Cloudflare R2

1. Bucket `emaseo-incidents` con Public Development URL habilitada.
2. API Token con Object Read & Write.

### 11.3 VPS Contabo

Cloud VPS 10 (4 vCPU, 8 GB RAM, Ubuntu 22.04). Bootstrap:
```bash
apt update && apt install -y ca-certificates curl gnupg ufw git
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
# Docker, Caddy, Docker IPv6 — ver guía completa en deploy/README.md
```

### 11.4 DuckDNS

Cron `/opt/duckdns/update.sh` cada 5 min para mantener DNS actualizado.

### 11.5 Caddy

`/etc/caddy/Caddyfile`:
```caddy
micemaseo.duckdns.org {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
    }
    reverse_proxy 127.0.0.1:4000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

### 11.6 `.env` de producción

```env
NODE_ENV=production
DB_HOST=db.<ref>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_SSL=true
# ... DB_PASSWORD_AUTH/USERS/IMAGE, JWT_SECRET, INTERNAL_TOKEN, Redis, R2, SMTP ...
CORS_ORIGINS=https://micemaseo.duckdns.org,https://mic-emaseo-panel.pages.dev,https://mic-emaseo-admin.pages.dev
```

### 11.7 Levantar el stack backend

```bash
cd /opt/mic-emaseo
git pull
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -sS https://micemaseo.duckdns.org/health   # → {"status":"ok"}
```

Para actualizar un servicio específico:
```bash
docker compose -f docker-compose.prod.yml build <servicio>
docker compose -f docker-compose.prod.yml up -d <servicio>
```

### 11.8 Panel supervisor en Cloudflare Pages

```bash
cd Frontend/supervisor-panel
npm install
VITE_API_URL=https://micemaseo.duckdns.org/api npm run build
npx wrangler pages project create mic-emaseo-panel --production-branch=main   # 1ª vez
npx wrangler pages deploy dist --project-name=mic-emaseo-panel --branch=main
```

### 11.9 Panel administrador en Cloudflare Pages

```bash
cd Frontend/admin-panel
npm install
npm run build   # usa .env.production (VITE_API_URL=https://micemaseo.duckdns.org/api)
npx wrangler pages project create mic-emaseo-admin --production-branch=main   # 1ª vez
npx wrangler pages deploy dist --project-name=mic-emaseo-admin --branch=main
```

### 11.10 APK móvil con EAS Build

```bash
cd Frontend/smart-waste-mobile
npx eas-cli build --profile preview --platform android --non-interactive --no-wait
```

> **Nota monorepo:** copiar `smart-waste-mobile/` a un directorio aislado antes de correr EAS Build (el repo completo con `ML/` es muy grande para el upload de EAS).

---

## 12. Variables de entorno

| Variable | Descripción | Ejemplo |
|---|---|---|
| `DB_HOST` / `DB_PORT` | Host Postgres | dev: `postgres`/`5432`; prod: `db.<ref>.supabase.co`/`5432` |
| `DB_NAME` | Base de datos | dev: `MIC-EMASEO`; prod: `postgres` |
| `DB_SSL` | TLS a Postgres | `false` / `true` |
| `DB_USER_AUTH/USERS/IMAGE` | Roles de servicio | `auth_svc`, `users_svc`, `image_svc` |
| `DB_PASSWORD_AUTH/USERS/IMAGE` | Passwords de cada rol | `openssl rand -base64 32` |
| `JWT_SECRET` | Firma access tokens | `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | TTL access token | `15m` |
| `BCRYPT_ROUNDS` | Cost factor bcrypt | `10` dev / `12` prod |
| `INTERNAL_TOKEN` | Token inter-servicios | `openssl rand -base64 32` |
| `REDIS_PASSWORD` | Password Redis | `openssl rand -base64 24` |
| `S3_ENDPOINT` | Endpoint S3/R2 | `https://<acct>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Bucket | `emaseo-incidents` |
| `S3_PUBLIC_URL` | URL pública imágenes | `https://pub-<id>.r2.dev` |
| `SMTP_HOST/PORT/USER/PASS/EMAIL_FROM` | SMTP para OTP | Gmail App Password |
| `PUBLIC_API_URL` | URL pública API | `https://micemaseo.duckdns.org` |
| `CORS_ORIGINS` | Orígenes permitidos | `https://mic-emaseo-panel.pages.dev,https://mic-emaseo-admin.pages.dev` |
| `DUMMY_MODE` | Simula ML sin modelo | `false` |
| `PRE_CHECK_THRESHOLD` | Umbral pre-check | `0.35` |
| `REGISTRY` / `TAG` | Imágenes GHCR | `ghcr.io/jsmena5` / `latest` |

---

## 13. Flujos principales

### 13.1 Reporte ciudadano (pipeline 4 decisiones)

```
App → POST /api/image/analyze (base64 + lat/lon)
    → Gateway: JWT + imageLimiter
    → Image Service:
        sharp validation
        INSERT incidents PROCESANDO
        ← 202 { task_id }

        [Celery + Redis]
        → Circuit Breaker → ML Service
        INCIDENTE_VALIDO   → R2 + estado=PENDIENTE
        REVISION_REQUERIDA → R2 + estado=EN_REVISION
        RECHAZO_CONFIABLE  → R2 + estado=DESCARTADO
        ERROR_TECNICO      → estado=FALLIDO

App ← GET /api/image/status/:task_id (backoff 500ms→8s)
```

### 13.2 Wizard supervisor + geocerca de cierre

```
Bandeja → incidente PENDIENTE
  Step1: ¿Real? → Sí → Step2 | No → RECHAZADA
  Step2: Firmar veredicto IA → ia_fue_correcta + correcciones
  Step3: Asignar operario → EN_ATENCION

  [Para pasar a RESUELTA]
  browser.geolocation.getCurrentPosition()
  → PUT /supervisor/incidents/:id/estado { estado: "RESUELTA", cierre_lat, cierre_lon }
  → backend: ST_Distance(ubicacion, punto_cierre) vs operations.config.geofence_tolerancia_m
  → Si distancia > tolerancia → 422 "Debes estar a X m"
  → Si OK → UPDATE incidents SET cierre_distancia_m + estado=RESUELTA
```

### 13.3 Geocerca configurable desde admin

```
Admin → PUT /api/users/config/geofence_tolerancia_m { valor: "25" }
      → operations.config UPSERT
      ← Próximo cierre usa la nueva tolerancia (sin reiniciar servicios)
```

### 13.4 Autenticación con auditoría

```
POST /api/auth/login
  → bcrypt.compare → genera tokens → INSERT audit.audit_log (LOGIN, ip, ua)
  ← { token, refreshToken }

POST /api/auth/refresh → rota tokens
POST /api/auth/change-password → INSERT audit.audit_log (CHANGE_PASSWORD)
POST /api/auth/reset-password  → INSERT audit.audit_log (RESET_PASSWORD)
```

### 13.5 Sesión móvil persistente

```
App arrancar → getSecure("emaseo_access_token")
  Token válido  → setUser(decoded), ir a Home
  Token expirado → getSecure("emaseo_refresh_token")
    Refresh válido → POST /auth/refresh → nuevo par → setUser, ir a Home
    Sin refresh    → pantalla de Login
```

---

## 14. Usuarios de prueba

### Producción (Supabase)

| Email | Rol | Notas |
|---|---|---|
| `admin@emaseo.gob.ec` | ADMIN | Creado vía SQL en Supabase — accede a `mic-emaseo-admin.pages.dev` |
| `bryanfamiliat@gmail.com` | SUPERVISOR | Accede a `mic-emaseo-panel.pages.dev` |

Para crear supervisores: usar el panel admin → Supervisores → Nuevo.
Para crear ciudadanos: registrarse desde la app móvil.

### Desarrollo (`02_seed_data.sql`) — contraseña: `Test1234!`

| Email | Rol |
|---|---|
| `admin@emaseo.gob.ec` | ADMIN |
| `maria.lopez@emaseo.gob.ec` | SUPERVISOR |
| `pedro.garcia@emaseo.gob.ec` | OPERARIO |
| `luis.martinez@emaseo.gob.ec` | OPERARIO |
| `ana.ciudadana@gmail.com` | CIUDADANO |
| `jorge.ramirez@gmail.com` | CIUDADANO |

---

## 15. Estructura del proyecto

```
MIC-EMASEO-SISTEMA/
├── docker-compose.yml / .dev.yml / .prod.yml
├── start.ps1 / start.sh
├── .github/workflows/ci.yml          ← CI: lint + typecheck + build + Docker push GHCR
├── Backend/
│   ├── api-gateway/                  ← JWT + RBAC + Rate Limit + Swagger
│   │   └── src/index.js              ← CORS adaptivo (env + localhost siempre permitido)
│   ├── auth-service/                 ← OTP, refresh tokens, anti-enumeración, audit logging
│   │   └── src/controllers/auth.controller.js  ← logAuthEvent() para audit.audit_log
│   ├── users-service/                ← CRUD perfiles + staff + zonas + config
│   │   └── src/controllers/
│   │       ├── supervisor.controller.js
│   │       ├── operarios.controller.js
│   │       └── zone.controller.js    ← zonas PostGIS + config del sistema (nuevo v4.0)
│   ├── image-service/                ← pipeline 4-decisiones + Circuit Breaker + recovery
│   │   └── src/controllers/
│   │       ├── supervisor.controller.js   ← /supervisor/* + geocerca en cambiarEstado
│   │       ├── ia.controller.js           ← /supervisor/ia/* (nuevo v4.0)
│   │       ├── notification.controller.js ← /incidents/notifications/* (v3.5)
│   │       └── feedback.controller.js     ← /operario/feedback/*
│   ├── ml-service/                   ← FastAPI + Celery + RT-DETR-L
│   └── database/                     ← 39 migraciones + seed + script de roles
│       ├── 036_notifications_rw.sql  ← SELECT/UPDATE en notifications para image_svc
│       ├── 037_admin_config.sql      ← operations.config + geofence default 10m
│       ├── 038_geofence_closure.sql  ← columnas de cierre en incidents
│       └── 039_image_audit.sql       ← ai.image_audit para etiquetado ML
├── Frontend/
│   ├── smart-waste-mobile/           ← Expo SDK 54 (CIUDADANO)
│   │   └── src/screens/
│   │       ├── AlertsScreen.tsx      ← notificaciones reales (v3.5)
│   │       └── HelpScreen.tsx        ← guía de estados + FAQ (v3.5)
│   ├── supervisor-panel/             ← React 19 + Vite 8 + Tailwind 4
│   │   └── src/features/incidents/
│   │       └── Step3Assign.tsx       ← geocerca GPS al cerrar (v4.0)
│   └── admin-panel/                  ← React 19 + Vite 8 + Tailwind 4 (NUEVO v4.0)
│       └── src/features/dashboard/pages/
│           ├── Home.tsx              ← analytics dashboard
│           ├── Supervisores.tsx      ← CRUD supervisores
│           ├── Zonas.tsx             ← mapa + GeoJSON import
│           ├── FeedbackIA.tsx        ← calidad del modelo
│           ├── AuditoriaR2.tsx       ← etiquetado de imágenes
│           └── Configuracion.tsx     ← geocerca + contraseña
├── ML/
│   ├── modelos/rtdetr_l_best.pt      ← pesos (63 MB, ignorado por git)
│   └── scripts/                      ← pipeline de preparación de dataset
└── tests/test-integration.js
```

---

## 16. Migraciones y cambios destacables

| # | Archivo | Descripción |
|---|---|---|
| 01 | `01_init_schema.sql` | Esquema inicial: schemas, ENUMs, tablas, índices, triggers |
| 02 | `02_seed_data.sql` | Datos de prueba (solo dev) |
| 008 | `008_refresh_tokens.sql` | `refresh_tokens` con SHA-256 |
| 009 | `009_password_reset_tokens.sql` | OTP de recuperación con bcrypt |
| 010 | `010_incident_status_async.sql` | ENUMs PROCESANDO y FALLIDO |
| 011 | `011_consolidation.sql` | Triggers, funciones, consolidación |
| 012 | `012_db_users_isolation.{sql,sh}` | Roles `auth_svc` / `users_svc` / `image_svc` |
| 014 | `014_initial_status_history.sql` | Trigger AFTER INSERT para estado inicial |
| 015 | `015_missing_indexes.sql` | Índices detectados en perfilado |
| 016 | `016_data_validation.sql` | Constraints (cédula, ubicación en Ecuador, etc.) |
| 017 | `017_audit_schema.sql` | Schema `audit` + particiones mensuales |
| 018 | `018_device_tokens.sql` | Tokens FCM/APNs para push |
| 019 | `019_notifications_retry.sql` | Reintentos con backoff |
| 020 | `020_pending_registrations_to_auth.sql` | Mueve `pending_registrations` a `app_auth` |
| 021 | `021_partition_incidents.sql` | Particionamiento (no aplicado en prod) |
| 022 | `022_lopdp_arco_functions.sql` | Funciones ARCO (LOPDP) |
| 023 | `023_user_consents.sql` | Consentimiento LOPDP por versión |
| 024 | `024_pgcrypto_pii.sql` | Cifrado PII con pgcrypto |
| 025 | `025_rls_image_svc.sql` | Row Level Security image-service |
| 026 | `026_retention_policy.sql` | Política de retención de imágenes y notificaciones |
| 027 | `027_fix_chk_prioridad_requerida.sql` | Corrige CHECK de prioridad para nuevos estados |
| 028 | `028_add_ubicacion_aproximada.sql` | Columna `ubicacion_aproximada` para GPS no disponible |
| 029 | `029_celery_task_id.sql` | Columna `celery_task_id` para recovery |
| 030 | `030_analysis_feedback.sql` | `ai.analysis_feedback` — feedback binario operarios |
| 031 | `031_notifications_push_index.sql` | Índice parcial push-worker |
| **032** | `032_human_review_flow.sql` | **EN_REVISION + DESCARTADO + decision_automatica + imagen_auditoria_url** |
| **033** | `033_supervisor_ia_corrections.sql` | **Correcciones supervisoras en analysis_results (ia_fue_correcta, *_supervisor)** |
| 034 | `034_fix_image_urls.sql` | Data-fix URLs de imágenes |
| **035** | *(no numerado)* | Cambio de contraseña desde el panel supervisor |
| **036** | `036_notifications_rw.sql` | SELECT + UPDATE en `notifications.notifications` para image_svc |
| **037** | `037_admin_config.sql` | `operations.config` + `geofence_tolerancia_m=10` por defecto |
| **038** | `038_geofence_closure.sql` | `cierre_lat/lon/foto_url/distancia_m` en incidents + GRANT config a image_svc |
| **039** | `039_image_audit.sql` | `ai.image_audit` (ENUM + tabla de etiquetas para reentrenamiento) |

**Cambios de código significativos (v3.5 y v4.0):**

- **Audit logging en auth** — `logAuthEvent()` en `auth.controller.js` registra LOGIN/CHANGE_PASSWORD/RESET_PASSWORD en `audit.audit_log` con IP real y user-agent.
- **CORS adaptivo en gateway** — `localhost:*` siempre permitido; orígenes de producción en `CORS_ORIGINS` (env). Evita tener que editar `.env` del VPS durante desarrollo.
- **Admin panel completo** — Nuevo proyecto Vite en `Frontend/admin-panel`; tokens aislados (`admin_token` ≠ `token` del supervisor-panel); 6 páginas: Home / Supervisores / Zonas / Modelo IA / Auditoría R2 / Configuración.
- **Geocerca de cierre** — `cambiarEstado` valida `ST_Distance` al pasar a RESUELTA; tolerancia configurable en DB sin reiniciar servicios; Step3Assign captura GPS del browser.
- **Notificaciones reales en móvil** — `AlertsScreen` reemplaza array estático; endpoint `/incidents/notifications` en image-service con SELECT/UPDATE para `image_svc`.
- **Sesión persistente en móvil** — `AuthContext.restoreSession` intenta refresh silencioso antes de pedir login.
- **Rename `auth` → `app_auth`** (commit `159d45b`) — 9 archivos backend actualizados para evitar colisión con Supabase Auth.
- **Dataset de reentrenamiento** — `/supervisor/ia/dataset` exporta análisis supervisados en JSON; `/supervisor/ia/imagenes` + `/etiqueta` permite curaduría individual desde el admin.

---

## 17. Licencia y créditos

**Trabajo de integración curricular — Carrera de Tecnologías de la Información**
Universidad de las Fuerzas Armadas ESPE — 2026

**Tutor:** Ing. Washington Eduardo Loza Herrera, Mgtr.

**Autores:**
- **Mena James** — C.C. 1752784460
- **Ortiz Bryan** — C.C. 1754336160

**Entidad beneficiaria:** EMASEO EP — Empresa Pública Metropolitana de Aseo, Quito.

**Dataset:** [Garbage Collector v8 — Roboflow Universe](https://universe.roboflow.com/garbage-epywh/garbage-collector-qcgu1) + [TACO](https://github.com/pedropro/TACO) + Street Trash + Garbage Detection (Roboflow) + 501 fotografías negativas de Quito.

**Modelo base:** RT-DETR-L — Baidu Research / Ultralytics.

> Este sistema no está afiliado oficialmente a EMASEO EP. Los datos en producción son de demostración. Las credenciales de servicios cloud viven exclusivamente en `.env.production.local` (fuera de git).
