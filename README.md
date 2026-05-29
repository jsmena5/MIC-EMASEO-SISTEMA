# MIC EMASEO — Sistema de Gestión Inteligente de Residuos Urbanos

> **v3.0 — Sistema en producción** · Backend en Contabo + Supabase + Cloudflare R2 · Panel en Cloudflare Pages · APK Android distribuible
>
> Plataforma de detección y gestión de acumulación de basura para **EMASEO EP** (Distrito Metropolitano de Quito, Ecuador).
> Los ciudadanos reportan mediante foto + GPS; la IA (RT-DETR-L v2) clasifica el nivel de acumulación y decide entre cuatro vías (válido / dudoso / rechazo confiable / error técnico); el supervisor revisa, corrige y asigna.

---

## Sistema en producción

| Componente | URL | Tecnología |
|---|---|---|
| **API backend** | https://micemaseo.duckdns.org | Contabo VPS + Docker + Caddy + Let's Encrypt |
| **Panel supervisor** | https://mic-emaseo-panel.pages.dev | Cloudflare Pages (Vite build estático) |
| **APK móvil (Android)** | Generado vía EAS Build (`eas build:list`) | React Native + Expo SDK 54 |
| **Base de datos** | Supabase managed (región `sa-east-1`, São Paulo) | PostgreSQL 17 + PostGIS + pgcrypto |
| **Almacenamiento de imágenes** | Cloudflare R2 — bucket `emaseo-incidents` | S3-compatible |
| **DNS** | DuckDNS — `micemaseo.duckdns.org` (cron de auto-update en el VPS) | Free dynamic DNS |

**Costo mensual operativo:** ~$5.40 USD (solo Contabo VPS 10). Supabase, R2, Pages, DuckDNS y EAS están dentro de planes gratuitos.

---

## Índice

1. [Características principales](#1-características-principales)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura — desarrollo y producción](#3-arquitectura--desarrollo-y-producción)
4. [Microservicios backend](#4-microservicios-backend)
5. [Modelo de Machine Learning y pipeline de decisión](#5-modelo-de-machine-learning-y-pipeline-de-decisión)
6. [Frontend — app móvil y panel web](#6-frontend--app-móvil-y-panel-web)
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

- **Reporte ciudadano con foto + GPS** — La app móvil captura imagen y coordenadas en un solo gesto, con permisos secuenciales y cola offline en `AsyncStorage` (reintento FIFO con backoff exponencial al recuperar conectividad).
- **Detección con IA RT-DETR-L v2** — Modelo transformer entrenado en GPU NVIDIA T4 sobre 21 987 imágenes (4 fuentes fusionadas + 501 negativas de Quito). **mAP@50 = 0.8802** (+85.2% vs baseline), precisión 0.884, recall 0.820.
- **Pipeline de decisión en 4 vías** — La IA no clasifica solo "hay basura / no hay basura"; emite uno de cuatro veredictos: `INCIDENTE_VALIDO`, `RECHAZO_CONFIABLE`, `REVISION_REQUERIDA` o `ERROR_TECNICO`. Cada uno deriva a un estado distinto del incidente (PENDIENTE, DESCARTADO, EN_REVISION, FALLIDO).
- **Revisión supervisada con corrección estructurada** — El supervisor puede firmar un veredicto sobre la decisión IA (`ia_fue_correcta`) y corregir nivel/tipo (`*_supervisor`) sin sobrescribir el dato original ML, preservando el dataset para auditoría y reentrenamiento.
- **Pipeline asíncrono 202 + polling** — Respuesta HTTP inmediata con `task_id`; el cliente sondea con backoff (500 ms → 8 s); si cancela, el `task_id` queda en `AsyncStorage` y la pantalla de historial hace auto-polling cada 5 s.
- **Circuit Breaker (opossum)** sobre el ML Service para degradar elegantemente.
- **Asignación automática por zona** — PostGIS `ST_Covers` asigna `zona_id` por polígono EPSG:4326 mediante trigger; si la ubicación es aproximada (GPS no disponible) queda para revisión manual.
- **Auditoría completa** — Schema `audit` con triggers automáticos en INSERT/UPDATE/DELETE de tablas críticas; particiones mensuales (`audit.audit_log_YYYY_MM`).
- **Validación de cédula ecuatoriana** — Función `public.fn_validar_cedula_ec()` implementa el algoritmo Módulo 10 del Registro Civil.
- **Rate limiting granular** por endpoint (login 5/15min, OTP 10/15min, imagen 20/h, forgot-password 5/h, global 100/15min).
- **Anti-enumeración** — Login devuelve siempre el mismo mensaje para email inexistente y contraseña errónea.
- **Rechazo amigable (Friendly Rejection)** — Si la IA decide `RECHAZO_CONFIABLE`, el incidente queda en `DESCARTADO` con la imagen preservada en R2/MinIO para auditoría (no se elimina, a diferencia del flujo anterior).
- **Notificaciones push** — Expo Notifications al ciudadano cuando cambia el estado de su reporte; WebSocket al supervisor para alertas CRÍTICO/ALTO.
- **HTTPS automático en producción** — Caddy obtiene y renueva certificados Let's Encrypt sin configuración manual.

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
| App móvil | React Native + Expo SDK 54 + TypeScript | EAS Build |
| Panel web | React 19 + Vite 8 + TypeScript + Tailwind 4 + React Leaflet | Cloudflare Pages |
| Modelo IA | RT-DETR-L v2 (`rtdetr_l_best.pt`) — 32.8 M params, 63 MB | Entrenado en Colab T4 |
| Documentación API | swagger-jsdoc + swagger-ui-express | `/api-docs` |
| Logs | pino (JSON estructurado) | Campos sensibles → `[REDACTED]` |

---

## 3. Arquitectura — desarrollo y producción

### 3.1 Desarrollo local (Docker Compose)

Todo corre en un solo `docker compose up -d`. PostgreSQL, MinIO, Redis y todos los microservicios están dentro de la misma red bridge `emaseo_network`. Solo el API Gateway (puerto 4000) se publica al host.

```
Cliente móvil ──┐
                ├──► API Gateway :4000 ──┬──► Auth :3002 ────► PostgreSQL :5432
Panel web ──────┘    (Helmet + JWT +     ├──► Users :3000 ───►   (PostGIS)
                      Rate Limit +       ├──► Image :5000 ───┬─► MinIO :9000
                      RBAC + Swagger)    │                   └─► Redis :6379
                                         └──► ML API :8000 ──► ML Worker (Celery)
```

### 3.2 Producción (cloud distribuido)

Misma arquitectura lógica, infraestructura distinta. La aplicación móvil y el panel web hablan con el backend a través de HTTPS público; el backend usa servicios managed en lugar de contenedores propios para la DB y el object storage.

```
┌─────────────────────┐         ┌───────────────────────────────┐
│  📱 APK Android     │         │  🌐 Panel supervisor          │
│  (EAS Build)        │         │  Cloudflare Pages             │
└──────────┬──────────┘         │  mic-emaseo-panel.pages.dev   │
           │                    └────────────┬──────────────────┘
           │   HTTPS                         │  HTTPS + CORS
           ▼                                 ▼
┌──────────────────────────────────────────────────────────────┐
│            Caddy :443  ──►  Let's Encrypt cert               │
│            micemaseo.duckdns.org  (DuckDNS A record)         │
│            VPS Contabo Cloud VPS 10 (Ubuntu 22.04)           │
└────────────────────────────┬─────────────────────────────────┘
                             │  reverse_proxy 127.0.0.1:4000
                             ▼
┌──────────────────────────────────────────────────────────────┐
│   Docker Compose (network IPv4 + IPv6 NAT habilitado)        │
│   ┌──────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│   │ Gateway  │─▶│  Auth  │  │ Users  │  │ Image  │           │
│   │  :4000   │  │ :3002  │  │ :3000  │  │ :5000  │           │
│   └──────────┘  └────┬───┘  └───┬────┘  └────┬───┘           │
│                      │          │            │               │
│                      └──┬───────┴────────────┘               │
│                         │ pg (auth_svc / users_svc / image_svc)
│                         │ IPv6 directo                       │
│                         ▼                                    │
│         Supabase  db.<ref>.supabase.co :5432  (IPv6)         │
│           PostgreSQL 17 + PostGIS + pgcrypto                 │
│           Schema renombrado: app_auth (no colisiona con Supabase Auth)
│                                                              │
│   ┌──────────┐  ┌─────────────┐                              │
│   │ ML API   │  │ ML Worker   │──► Redis :6379 (broker local) │
│   └────┬─────┘  └─────────────┘                              │
│        │ S3 SDK                                              │
│        ▼                                                     │
│   Cloudflare R2  (emaseo-incidents)                          │
│   pub-<id>.r2.dev  →  imágenes públicas para el panel        │
└──────────────────────────────────────────────────────────────┘
```

**Decisiones técnicas clave del despliegue:**

- **Schema `auth` renombrado a `app_auth`** — Supabase reserva el schema `auth` para Supabase Auth (gotrue). Para evitar colisión con `auth.users` y `auth.refresh_tokens` se renombró nuestro schema. La DB local sigue la misma convención para no divergir.
- **Conexión directa por IPv6 (puerto 5432)** en lugar del pooler de Supabase. El pooler (Supavisor) solo conoce el usuario `postgres`; los roles personalizados `auth_svc`/`users_svc`/`image_svc` no están en su registro y devuelven `tenant/user not found`. La conexión directa sí los acepta y mantenemos el principio de mínimo privilegio.
- **Docker IPv6 habilitado** (`/etc/docker/daemon.json` con `"ipv6": true, "ip6tables": true, "fixed-cidr-v6": "fd00:dead:beef::/48"`) más `enable_ipv6: true` en la network de compose. Sin esto los contenedores no enrutan al host IPv6 de Supabase.
- **`search_path` por rol** — `ALTER ROLE auth_svc SET search_path = public, extensions, "$user"` para que `crypt()` y `gen_salt()` (en el schema `extensions` de Supabase) sean accesibles sin calificar.
- **No usamos Supabase Auth ni Data API** — las desactivamos al crear el proyecto. Supabase es **solo** Postgres + PostGIS.

---

## 4. Microservicios backend

### API Gateway `:4000`

- Proxy a microservicios upstream con `http-proxy-middleware`.
- Validación de JWT (access token, 15 min) antes de reenviar.
- RBAC con middlewares `requireCiudadano`, `requireOperario`, `requireSupervisor`, `requireAdmin`.
- Rate limiting granular: global 100/15min · login 5/15min · OTP 10/15min · imagen 20/h · forgot-password 5/h.
- `app.set("trust proxy", 1)` para leer la IP real detrás de Caddy / Cloudflare Tunnel.
- Inyecta `X-Internal-Token` en cada petición upstream; los servicios rechazan 403 si falta.
- Swagger UI en `/api-docs`.

### Auth Service `:3002`

| Endpoint | Descripción |
|---|---|
| `POST /api/auth/login` | Devuelve `access_token` (15 min) + `refresh_token` (7 días, SHA-256 en DB). Anti-enumeración: mensaje genérico para email inexistente o password errónea. |
| `POST /api/auth/refresh` | Rotación de refresh token. |
| `POST /api/auth/logout` | Revoca el refresh token. |
| `POST /api/auth/forgot-password` | OTP 6 dígitos (TTL 15 min), **bcrypt en DB**, email vía SMTP. |
| `POST /api/auth/verify-reset-otp` | Valida el OTP hasheado. |
| `POST /api/auth/reset-password` | Actualiza contraseña en transacción atómica + devuelve JWT listo. |
| `POST /api/auth/register` | Paso 1 — INSERT en `app_auth.pending_registrations` + OTP. |
| `POST /api/auth/verify-otp` | Paso 2 — valida OTP de registro. |
| `POST /api/auth/set-password` | Paso 3 — INSERT `app_auth.users` + `public.ciudadanos` + `app_auth.user_consents` (LOPDP). |

### Users Service `:3000`

CRUD de perfiles ciudadanos y staff (operarios/supervisores/admins). Endpoints para crear, listar, editar y desactivar usuarios. Incluye `supervisor.controller.js` con endpoints para gestionar el staff operativo y `operarios.controller.js` para asignaciones.

### Image Service `:5000`

Orquestador del flujo de reporte. **Implementa la nueva máquina de estados de 4 decisiones** (migración 032):

```
1. Validación de imagen (sharp):
   ├─ Magic bytes (JPEG/PNG)
   ├─ Dimensiones mínimas 320 × 320 px
   └─ Tamaño mínimo 1 KB (anti-polyglot)

2. INSERT incidents (estado=PROCESANDO, decision_automatica=NULL)
   ← 202 { task_id, poll_url }   ← respuesta inmediata

3. [background — Celery via Redis]
   → Circuit Breaker → POST ml-api:8000/predict
   ← La respuesta del ML incluye `decision_automatica` ∈
      { INCIDENTE_VALIDO, RECHAZO_CONFIABLE, REVISION_REQUERIDA, ERROR_TECNICO }

   Según el veredicto:
   ├─ INCIDENTE_VALIDO   → estado=PENDIENTE   (imagen + analysis_results en DB)
   ├─ REVISION_REQUERIDA → estado=EN_REVISION (imagen preservada, espera supervisor)
   ├─ RECHAZO_CONFIABLE  → estado=DESCARTADO  (imagen preservada para auditoría)
   └─ ERROR_TECNICO      → estado=FALLIDO     (imagen preservada si ya estaba en S3)

4. GET /api/image/status/:task_id (polling)
   ← 202 PROCESANDO | 200 con estado final + metadata
```

**Recovery periódico:** cada 30 s un job revisa incidentes en `PROCESANDO` por más de 3 minutos y reintenta su tarea Celery (campo `celery_task_id`).

**Endpoints supervisores** (servidos por `image-service`, ruta `/supervisor/*`):

| Endpoint | Descripción |
|---|---|
| `GET /supervisor/incidents` | Lista paginada con filtros: `estado`, `prioridad`, `zona_id`, `decision_automatica`, `fecha_desde`, `fecha_hasta`, `ia_incorrecta`, `sin_supervisar`, `sort=priority\|newest`, `page`, `limit`. |
| `GET /supervisor/incidents/:id` | Detalle completo: historial, asignaciones, feedback IA, correcciones supervisoras. |
| `PUT /supervisor/incidents/:id/estado` | Cambio de estado con transición validada (FSM). |
| `POST /supervisor/incidents/:id/asignar` | Asigna operario (opcional: fecha esperada, notas). |
| `PUT /supervisor/incidents/:id/revision-ia` | Veredicto supervisado: `es_correcta_ia`, `nivel_acumulacion_supervisor`, `tipo_residuo_supervisor`, comentario. Idempotente (puede llamarse varias veces). |
| `GET /supervisor/operarios` | Lista de operarios activos para el dropdown del wizard. |

### ML Service `:8000`

FastAPI + Gunicorn (4 workers) + Celery worker. Detalles en la sección 5.

---

## 5. Modelo de Machine Learning y pipeline de decisión

**Archivo:** `Backend/ml-service/main.py` + `tasks.py`
**Pesos:** `ML/modelos/rtdetr_l_best.pt` (RT-DETR-L v2, 63 MB, 32.8 M params)
**Framework:** FastAPI + Ultralytics 8.3 + Celery + Redis
**Arquitectura del modelo:** RT-DETR-L (Real-Time Detection Transformer, large variant)

### 5.1 Métricas (v1 → v2)

| Métrica | v1 (CPU, dataset 12 k) | v2 (GPU T4, dataset 22 k) | Mejora |
|---|---|---|---|
| mAP@50 | 0.4752 | **0.8802** | +85.2% |
| mAP@50:95 | 0.2450 | **0.6069** | +147.7% |
| Precision | 0.5523 | **0.8840** | +60.1% |
| Recall | 0.4353 | **0.8203** | +88.5% |

Evaluado sobre el conjunto de validación (3 531 imágenes), best epoch 64/100, optimizador AdamW, `lr0=0.0001`, batch=16, cosine annealing, augmentation Mosaic + HSV + Erasing + CopyPaste 0.1.

### 5.2 Dataset

**1 clase remapeada (`garbage`, nc=1)** — 21 987 train + 3 531 val.

| Fuente | Tipo | Aporte |
|---|---|---|
| Garbage Collector v8 (Roboflow) | YOLO | Base principal |
| TACO (pedropro/TACO en GitHub) | COCO JSON → YOLO | Imágenes de campo reales |
| Garbage Detection (Roboflow) | YOLO | Variedad de escenas |
| Street Trash (Roboflow) | YOLO | Basura en vía pública |
| **501 fotografías negativas de Quito** | YOLO (sin etiquetas) | Background — calles limpias para reducir falsos positivos |

Pipeline de preparación: scripts numerados `01_descargar_taco.py` → `06_agregar_taco.py` en `ML/scripts/` (con `unique_stem()` para evitar colisión de nombres entre `batch_N/000000.jpg`).

### 5.3 Pipeline de inferencia y pre-check

```
Imagen base64 → Decodificación PIL → resize 640×640
   │
   ├── (opcional) /ml/pre-check  → garbage_score, is_garbage, threshold
   │                              ↑ thumbnail liviano para validación rápida desde el móvil
   │
   └── /predict (vía Celery worker):
       → RTDETR.predict(conf=0.35, iou=0.50)
       → Filtro whitelist de clases
       → Filtro área < 0.5% del frame (ruido)
       │
       ├── Sin detecciones válidas → decision_automatica = RECHAZO_CONFIABLE
       │                            → estado = DESCARTADO (imagen preservada)
       │
       └── Con detecciones → cálculo de coverage_ratio + effective_ratio:
           ├─ conf_factor   = min(1.0, conf_media / 0.60)
           ├─ det_factor    = min(1.0, 0.40 + 0.20 × num_detecciones)
           ├─ ISOLATION_PENALTY × 0.65 si 1 bbox > 55 % del frame
           ├─ class_weight (PELIGROSO ×1.30 … RECICLABLE ×0.85)
           └─ scale_penalty si hay muchas detecciones diminutas

           effective_ratio = coverage_ratio × conf_factor × det_factor × class_weight
                             × ISOLATION_PENALTY (si aplica) × scale_penalty
```

### 5.4 Bandas de clasificación y estimación de volumen

| `effective_ratio` | Nivel | Prioridad | Volumen estimado |
|---|---|---|---|
| 0.00 – 0.15 | BAJO | BAJA | 0.1 – 0.5 m³ |
| 0.15 – 0.40 | MEDIO | MEDIA | 0.5 – 2.0 m³ |
| 0.40 – 0.70 | ALTO | ALTA | 2.0 – 5.0 m³ |
| 0.70 – 1.00 | CRÍTICO | CRÍTICA | 5.0 – 15.0 m³ |

**Sobre el "volumen":** no se calcula con una fórmula geométrica directa (π·r²·h ni área·d). El sistema emite un **rango estimado** mapeando el `effective_ratio` a una banda predefinida. Es una proxy operativa para priorización, no una medición física. Ver detalles en `Backend/ml-service/tasks.py`.

### 5.5 Las cuatro decisiones automáticas

El ML no devuelve solo `has_waste: true/false` como en la versión anterior. Devuelve un veredicto estructurado en el campo `decision_automatica` que el image-service mapea a un estado del incidente:

| `decision_automatica` | Significado | Estado final del incidente |
|---|---|---|
| `INCIDENTE_VALIDO` | Detecciones con buena confianza → reporte real | `PENDIENTE` (visible al supervisor para asignación) |
| `REVISION_REQUERIDA` | Detecciones ambiguas / confianza media | `EN_REVISION` (el supervisor decide si validar o descartar) |
| `RECHAZO_CONFIABLE` | Sin detecciones, ML confiado en que no hay basura | `DESCARTADO` (imagen preservada para auditoría) |
| `ERROR_TECNICO` | Fallo de inferencia (timeout, modelo caído) | `FALLIDO` (imagen preservada si ya estaba en S3) |

Diferencia clave con el flujo anterior: ya no se elimina la imagen en `FALLIDO`/`DESCARTADO`. Toda imagen se preserva en R2 (`imagen_auditoria_url`) para que el supervisor pueda revisarla y, si la IA se equivocó, anular el rechazo automático llevando el incidente a `PENDIENTE`.

### 5.6 Corrección supervisada (migración 033)

Cuando el supervisor revisa un incidente, puede firmar un veredicto sobre la IA sin sobrescribir el resultado original. Las columnas `*_supervisor` en `ai.analysis_results` son **aditivas**:

| Campo | Tipo | Significado |
|---|---|---|
| `ia_fue_correcta` | `boolean` | `TRUE` si el supervisor avala la decisión IA, `FALSE` si la corrige, `NULL` si aún no se revisó |
| `nivel_acumulacion_supervisor` | `ai.accumulation_level` | Nivel real según el supervisor (NULL si la IA estaba bien) |
| `tipo_residuo_supervisor` | `ai.waste_type` | Tipo real (NULL si la IA estaba bien) |
| `nota_supervision` | `text` | Comentario libre de auditoría |
| `supervisado_por` | `uuid` | FK a `app_auth.users` |
| `supervisado_at` | `timestamptz` | Cuándo se firmó |

Estos datos alimentan dos cosas: el pipeline de detección de drift del modelo (junto con `ai.analysis_feedback` de operarios) y la trazabilidad de auditoría para EMASEO.

---

## 6. Frontend — app móvil y panel web

### 6.1 App móvil — `Frontend/smart-waste-mobile/`

**Stack:** React Native + Expo SDK 54 + TypeScript + SecureStore + Expo Camera + Expo Location + AsyncStorage.

| Pantalla | Función |
|---|---|
| `LoginScreen` / `RegisterScreen` | Wizard de 3 pasos: datos → OTP email → contraseña |
| `ForgotPasswordScreen` | Recuperación por OTP de 3 pasos |
| `ResetPasswordScreen` | Nueva contraseña + login automático (el backend devuelve JWT listo) |
| `ScanScreen` | Cámara con overlay de recuadro, GPS automático, animación de escaneo, timeout 110 s; cancelar guarda `task_id` en `AsyncStorage` (no aborta el análisis) |
| `ScanResultScreen` | Nivel, volumen, tipo, confianza del análisis IA |
| `HistorialScreen` | Lista de reportes; auto-polling cada 5 s mientras haya incidentes en `PROCESANDO` |
| `ReportDetailScreen` | Mapa interactivo + geocoding inverso + foto desde R2/MinIO |
| `PerfilScreen` | Datos del ciudadano + logout |

**Particularidades:**
- Tokens en **SecureStore** (cifrado del dispositivo) — no en AsyncStorage.
- Cola offline FIFO con backoff exponencial en `src/services/offlineQueue.js`.
- Recorte real al recuadro del overlay con `expo-image-manipulator` (constantes en `src/utils/cropToScanFrame.ts`); recorte y captura de GPS se hacen en paralelo.
- Pre-check de basura (~15 KB thumbnail a `/ml/pre-check`) antes del upload completo: fail-closed (si el pre-check falla por red, NO se asume optimista).
- Validación de password sincronizada con el backend: 8+ chars, mayúscula, minúscula, dígito.

### 6.2 Panel supervisor — `Frontend/supervisor-panel/`

**Stack:** React 19 + Vite 8 + TypeScript + Tailwind CSS 4 + React Leaflet + lucide-react.
**Despliegue:** Cloudflare Pages (build estático). Build command: `npm install && npm run build`, output `dist/`, variable `VITE_API_URL=https://micemaseo.duckdns.org/api`.

**Layout tablet-first** (rediseñado en el sprint 3.5):
- Sidebar colapsable (80 px → 224 px) con icon+label, sin la card de logo gigante anterior.
- Topbar minimalista con avatar dropdown + chip de pendientes en vivo.
- Home con 4 KPI cards (Pendientes / En revisión / Asignados hoy / Resueltos hoy) + lista de 5 incidencias críticas.

**Bandeja de incidencias con wizard de 3 pasos** (`Frontend/supervisor-panel/src/features/incidents/`):

```
┌─ IncidentRail (filtros + lista) ──┐  ┌─ Workspace (Stepper) ──────────────────┐
│ FiltersBar.tsx                    │  │ Step1Validate.tsx                       │
│   - estado, prioridad, zona       │  │   "¿Es un reporte real?" → 2 botones    │
│   - decision_automatica           │  │   ├─ ✅ Es real → avanza al paso 2     │
│   - fecha_desde / fecha_hasta     │  │   └─ ❌ Descartar → RECHAZADA          │
│   - ia_incorrecta (toggle)        │  │                                         │
│   - sin_supervisar (toggle)       │  │ Step2Classify.tsx                       │
│   - sort: priority / newest       │  │   Formulario IA: validar tipo, nivel,   │
│ IncidentRail.tsx                  │  │   firmar es_correcta_ia + comentario   │
│   - card pequeño por incidente    │  │                                         │
│   - badge color por nivel         │  │ Step3Assign.tsx                         │
└───────────────────────────────────┘  │   Select de operario + notas → asigna   │
                                       │   y deja el incidente en EN_ATENCION    │
                                       │                                         │
                                       │ CaseTimeline.tsx                        │
                                       │   Timeline unificado al pie             │
                                       └─────────────────────────────────────────┘
```

**Reglas del wizard:**
- No se puede saltar al paso 3 si el paso 1 dice "no es real".
- El paso 2 requiere completarse antes del paso 3.
- Si se reabre un caso, el wizard retoma en el paso correspondiente según `incident.estado`.
- Para casos `RECHAZO_CONFIABLE` viejos, el Paso 1 pre-marca "Descartar" y pide solo confirmación.

**Estilos:** se eliminaron los `rounded-[28px]` y gradientes; ahora `rounded-2xl` + fondos planos. Tipografía bajada de `text-3xl` a `text-xl` en títulos. Migración progresiva de CSS-in-JS inline a Tailwind (se mantiene `styles.ts` como fallback centralizado).

---

## 7. Esquema de base de datos

**Motor (dev):** PostgreSQL 16 + PostGIS 3.4 + pgcrypto (Docker `postgis/postgis:16-3.4`).
**Motor (prod):** PostgreSQL 17 + PostGIS + pgcrypto (Supabase managed, región `sa-east-1`).
**Scripts:** `Backend/database/01_init_schema.sql` … `034_fix_image_urls.sql` (28 migraciones + seed + queries de ejemplo + script de roles `012_db_users_isolation.{sql,sh}`).

### 7.1 Schemas

| Schema | Tablas principales |
|---|---|
| `app_auth` | `users`, `refresh_tokens`, `password_reset_tokens`, `pending_registrations`, `device_tokens`, `user_consents` |
| `public` | `ciudadanos` (perfil 1:1 con `app_auth.users`), tablas de PostGIS |
| `operations` | `operarios`, `zones` (polígonos PostGIS EPSG:4326) |
| `incidents` | `incidents`, `incident_images`, `status_history`, `assignments` |
| `ai` | `analysis_results` (JSONB detecciones + correcciones supervisor 033), `analysis_feedback` |
| `notifications` | `notifications` (con reintento + push index) |
| `audit` | `audit_log` particionado mensual (`audit_log_YYYY_MM`) |

> **Nota sobre el rename `auth` → `app_auth`:** En producción Supabase reserva el schema `auth` para Supabase Auth (tabla `auth.users` de gotrue, etc.). Para evitar colisión nuestro schema se renombró a `app_auth` y los 9 archivos del backend que tenían SQL con `auth.users`/`auth.refresh_tokens`/etc. fueron actualizados (commit `159d45b`). La DB local de desarrollo también usa `app_auth` para no divergir.

### 7.2 ENUMs clave

```sql
app_auth.user_role         : CIUDADANO | OPERARIO | SUPERVISOR | ADMIN
app_auth.user_status       : ACTIVO | INACTIVO | SUSPENDIDO
incidents.incident_status  : PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA
                             | PROCESANDO | FALLIDO | EN_REVISION | DESCARTADO
incidents.priority_level   : BAJA | MEDIA | ALTA | CRITICA
ai.waste_type              : DOMESTICO | ORGANICO | RECICLABLE | ESCOMBROS
                             | PELIGROSO | MIXTO | OTRO
ai.accumulation_level      : BAJO | MEDIO | ALTO | CRITICO
notifications.channel_type : PUSH | EMAIL
notifications.notification_status : PENDIENTE | ENVIADA | LEIDA | FALLIDA
```

`incidents.incidents.decision_automatica` es un `varchar(30)` con `CHECK` constraint sobre los 4 valores: `ERROR_TECNICO`, `RECHAZO_CONFIABLE`, `REVISION_REQUERIDA`, `INCIDENTE_VALIDO`.

### 7.3 Índices destacables

```sql
-- Geoespaciales (GIST)
CREATE INDEX idx_incidents_ubicacion_gist ON incidents.incidents USING gist (ubicacion);
CREATE INDEX idx_zones_geom_gist          ON operations.zones     USING gist (geom);

-- Detecciones JSON (GIN) — permite WHERE detecciones @> '[{"class":"PLASTICO"}]'
CREATE INDEX idx_ai_detecciones_gin ON ai.analysis_results USING gin (detecciones);

-- Parciales para los nuevos estados (032)
CREATE INDEX idx_incidents_en_revision ON incidents.incidents (created_at DESC)
   WHERE estado = 'EN_REVISION';
CREATE INDEX idx_incidents_descartado  ON incidents.incidents (created_at DESC)
   WHERE estado = 'DESCARTADO';

-- Supervisión IA (033)
CREATE INDEX idx_ai_ia_incorrecta      ON ai.analysis_results (supervisado_at DESC)
   WHERE ia_fue_correcta = false;
CREATE INDEX idx_ai_pendiente_revision ON ai.analysis_results (created_at DESC)
   WHERE supervisado_por IS NULL;
CREATE INDEX idx_ai_supervisado        ON ai.analysis_results (supervisado_por, supervisado_at DESC)
   WHERE supervisado_por IS NOT NULL;

-- Recovery Celery
CREATE INDEX idx_incidents_celery_pending ON incidents.incidents (celery_task_id)
   WHERE celery_task_id IS NOT NULL AND estado = 'PROCESANDO';
```

### 7.4 Triggers y funciones

- `incidents.fn_assign_zone` — BEFORE INSERT/UPDATE de `ubicacion`, usa `ST_Covers + ORDER BY ST_Area ASC` para asignar la zona más específica. Si `ubicacion_aproximada = TRUE`, deja `zona_id = NULL` con `nota_fallo` explicativa.
- `incidents.fn_log_status_change` — BEFORE UPDATE de `estado`, inserta en `incidents.status_history` y setea `resuelto_at` cuando pasa a `RESUELTA`.
- `incidents.fn_notify_citizen` — AFTER UPDATE de `estado`, inserta en `notifications.notifications` el mensaje correspondiente (incluye `DESCARTADO` en 032).
- `audit.fn_audit_trigger` — SECURITY DEFINER, captura `actor_id` y `actor_ip` desde `current_setting('audit.actor_id')` y registra INSERT/UPDATE/DELETE en `audit.audit_log`.
- `public.fn_validar_cedula_ec(text)` — algoritmo Módulo 10 del Registro Civil ecuatoriano para validar cédulas (CHECK constraint en `public.ciudadanos`).

### 7.5 Roles de mínimo privilegio

| Rol | Permisos |
|---|---|
| `auth_svc` | RW en `app_auth.*`, SELECT en `public.ciudadanos`, SELECT en `operations.operarios` |
| `users_svc` | RW en `public.*`, RW en `operations.*`, SELECT/INSERT/UPDATE en `app_auth.users`, RW en `app_auth.pending_registrations` y `user_consents` |
| `image_svc` | RW en `incidents.*` y `ai.*`, INSERT en `notifications.notifications`, SELECT en `app_auth.users`, `public.ciudadanos`, `operations.zones`, `operations.operarios` |

En producción cada rol tiene `search_path = public, extensions, "$user"` para acceder a `crypt()`, `gen_salt()`, `uuid_generate_v4()` (que en Supabase viven en el schema `extensions`).

---

## 8. Seguridad

| Capa | Medida |
|---|---|
| **Red (prod)** | Solo Caddy expone 80/443 (UFW). Gateway escucha en `127.0.0.1:4000`. Demás contenedores sin puertos al host. |
| **TLS** | Caddy obtiene y renueva certificados Let's Encrypt automáticamente para `micemaseo.duckdns.org`. HSTS + Strict-Transport-Security activos. |
| **Autenticación** | JWT (15 min) + refresh token rotatorio (7 días, SHA-256 en DB). |
| **Contraseñas** | bcrypt (cost 12 en prod, 10 en dev). Reglas: 8+ chars, mayúscula, minúscula, dígito. |
| **Anti-enumeración** | Login devuelve mensaje genérico para email inexistente vs password errónea. |
| **OTP** | 6 dígitos, bcrypt en DB, TTL 15 min, un solo uso. |
| **Comunicación interna** | `X-Internal-Token` en cada petición upstream; 403 si falta. |
| **CORS** | Origins configurables por env. En prod: `https://mic-emaseo-panel.pages.dev`. |
| **Rate limiting** | Granular por endpoint (ver sección 4). |
| **Validación de imágenes** | sharp: magic bytes JPEG/PNG, dimensiones mínimas, anti-polyglot. |
| **DB: mínimo privilegio** | Tres roles separados (`auth_svc`, `users_svc`, `image_svc`) con GRANT solo de lo que necesitan. |
| **DB: cifrado PII** | pgcrypto disponible en el schema `extensions` (Supabase) o `public` (dev). |
| **DB: auditoría** | Triggers en INSERT/UPDATE/DELETE de tablas críticas, particiones mensuales. |
| **Móvil** | Tokens en SecureStore (no AsyncStorage). Pre-check fail-closed. Cancelación de upload con `AbortController`. |
| **Logs** | pino JSON estructurado. Campos `password / token / otp / refresh_token` → `[REDACTED]`. |
| **Circuit Breaker** | opossum sobre el ML Service (50% errores / ventana 60 s). |

---

## 9. Infraestructura Docker

Nombre de proyecto fijo `name: emaseo` para que los volúmenes se llamen siempre `emaseo_postgres_data`, `emaseo_minio_data`, etc.

### 9.1 `docker-compose.yml` (desarrollo)

| Contenedor | Imagen / Build | Puerto host |
|---|---|---|
| `emaseo-postgres` | `postgis/postgis:16-3.4` | 5432 |
| `emaseo-minio` | `minio/minio:latest` | 9000 (+9001 con `-Dev`) |
| `emaseo-minio-init` | `minio/mc:latest` (efímero) | — |
| `emaseo-redis` | `redis:7-alpine` | (interno) |
| `emaseo-auth` | Build `./Backend/auth-service` | (interno) |
| `emaseo-users` | Build `./Backend/users-service` | (interno) |
| `emaseo-image` | Build `./Backend/image-service` | (interno) |
| `emaseo-gateway` | Build `./Backend/api-gateway` | **4000** |
| `emaseo-ml-api` | Build `./Backend/ml-service` | (interno) |
| `emaseo-ml-worker-1` | Build `./Backend/ml-service` | (interno) |
| `emaseo-flower` | `mher/flower:2.0` | 5555 (solo con `-Dev`) |

`docker-compose.dev.yml` se aplica como overlay (`-f docker-compose.yml -f docker-compose.dev.yml`) para exponer MinIO console, Redis y Flower al `127.0.0.1` del host.

### 9.2 `docker-compose.prod.yml`

Diferencias respecto a desarrollo:
- **Sin Postgres ni MinIO** — apuntamos a Supabase y a Cloudflare R2.
- **Sin `shared_uploads`** — las imágenes pasan por R2 vía el image-service.
- **Solo el Gateway publica puerto** — y solo en `127.0.0.1:4000`, ya que Caddy en el host es el único que llega a Internet.
- **`enable_ipv6: true`** en la network `emaseo_network` para que los contenedores puedan llegar al host IPv6 de Supabase.
- **Imágenes referenciadas como `ghcr.io/jsmena5/<svc>:latest`** con `build:` como fallback. Si el registry tiene la imagen, la jala; si no, la construye localmente.

---

## 10. Inicio rápido — desarrollo local

> Requisitos: Docker Desktop instalado y corriendo. Para la guía exhaustiva ver [`GUIA_EJECUCION.md`](GUIA_EJECUCION.md).

### ① Backend completo

**Windows (PowerShell):**
```powershell
.\start.ps1           # genera .env, construye imágenes y levanta 11 contenedores
.\start.ps1 -NoBuild  # arranque rápido cuando ya están las imágenes
.\start.ps1 -Build    # forzar reconstrucción tras cambios
.\start.ps1 -Dev      # expone MinIO :9001, Redis :6379, Flower :5555
.\start.ps1 -Tunnel   # backend + túnel Cloudflare para pruebas con datos móviles
```

**Linux / macOS / WSL:**
```bash
bash start.sh           # genera + construye + levanta
bash start.sh --no-build
bash start.sh --dev
```

**Manual:**
```bash
docker compose up -d --build   # primera vez
docker compose up -d           # sesiones posteriores
```

> **Nota Windows con espacios en la ruta:** los scripts `start.ps1/sh` lo solucionan. Si ejecutas Docker manualmente, crea una junction sin espacios:
> ```powershell
> cmd /c mklink /J C:\MIC-EMASEO-WORK "C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA"
> cd C:\MIC-EMASEO-WORK
> ```

### ② Panel supervisor (dev)

```bash
cd Frontend/supervisor-panel
npm install
npm run dev
# → http://localhost:5173
```

`.env` del panel:
```env
VITE_API_URL=http://localhost:4000/api
```

### ③ App móvil (dev con Expo)

```bash
cd Frontend/smart-waste-mobile
npm install
npx expo start
# Escanea el QR con Expo Go o presiona 'a' para abrir en emulador Android
```

`.env.development`:
```env
EXPO_PUBLIC_API_URL=http://<IP-LAN>:4000/api
```

### URLs útiles en dev

| Servicio | URL |
|---|---|
| API Gateway | `http://localhost:4000` |
| Swagger UI | `http://localhost:4000/api-docs` |
| Panel supervisor | `http://localhost:5173` |
| MinIO Console | `http://localhost:9001` (con `-Dev`) |
| Flower (Celery) | `http://localhost:5555` (con `-Dev`) |

---

## 11. Despliegue en producción

Esta sección documenta cómo se desplegó el sistema actualmente en producción. Sirve también como receta repetible.

### 11.1 Supabase (PostgreSQL managed)

1. Crear proyecto en https://supabase.com con región **South America (São Paulo)** (`sa-east-1`).
2. Desactivar Data API y RLS automático en la pantalla de creación (no usamos Supabase Auth ni PostgREST).
3. Guardar la contraseña de la DB del proyecto.
4. Vía MCP/SQL Editor:
   - `CREATE EXTENSION IF NOT EXISTS postgis;` (verificar que `uuid-ossp` y `pgcrypto` ya estén en el schema `extensions`).
   - Aplicar el dump consolidado del esquema con el rename `auth` → `app_auth`.
   - Ejecutar el script `012` (versión SQL) con los placeholders de password reemplazados por valores generados (`openssl rand -base64 32`).
   - `ALTER ROLE auth_svc SET search_path = public, extensions, "$user"` (idem `users_svc`, `image_svc`).
   - `GRANT USAGE ON SCHEMA extensions TO auth_svc, users_svc, image_svc;`
   - `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO auth_svc, users_svc, image_svc;`

### 11.2 Cloudflare R2 (object storage)

1. Crear bucket `emaseo-incidents`.
2. Habilitar **Public Development URL** (genera `https://pub-<id>.r2.dev`).
3. Crear Account API Token con **Object Read & Write** sobre el bucket; guardar `Access Key ID`, `Secret Access Key` y `Endpoint`.

### 11.3 VPS Contabo

1. Cloud VPS 10 (4 vCPU, 8 GB RAM, 75 GB NVMe), Ubuntu 22.04, región US Central (o EU si capacity).
2. Generar par SSH local (`ssh-keygen -t ed25519`) y subir la clave pública al servidor (vía el panel o `ssh-copy-id`).
3. Bootstrap del servidor:
   ```bash
   apt update && apt install -y ca-certificates curl gnupg ufw git
   ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

   # Docker
   install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
     > /etc/apt/sources.list.d/docker.list
   apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

   # Caddy
   apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
   apt update && apt install -y caddy

   # Docker IPv6 (necesario para llegar a Supabase IPv6 desde los contenedores)
   cat > /etc/docker/daemon.json <<JSON
   { "ipv6": true, "ip6tables": true, "fixed-cidr-v6": "fd00:dead:beef::/48" }
   JSON
   systemctl restart docker

   # Repo
   mkdir -p /opt && cd /opt && git clone https://github.com/jsmena5/MIC-EMASEO-SISTEMA.git mic-emaseo
   ```

### 11.4 DuckDNS

1. https://www.duckdns.org → crear subdominio (ej. `micemaseo`) apuntando a la IP del VPS.
2. Cron en el VPS para mantener la IP actualizada (cada 5 min):
   ```bash
   mkdir -p /opt/duckdns
   cat > /opt/duckdns/update.sh <<'EOF'
   #!/bin/bash
   curl -fsS "https://www.duckdns.org/update?domains=micemaseo&token=<TOKEN>&ip=" >> /var/log/duckdns.log 2>&1
   EOF
   chmod +x /opt/duckdns/update.sh
   ( crontab -l 2>/dev/null; echo "*/5 * * * * /opt/duckdns/update.sh" ) | crontab -
   ```

### 11.5 Caddy

`/etc/caddy/Caddyfile`:
```caddy
micemaseo.duckdns.org {
    encode zstd gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options    nosniff
        X-Frame-Options           DENY
        Referrer-Policy           strict-origin-when-cross-origin
    }
    reverse_proxy 127.0.0.1:4000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```
`systemctl reload caddy` y Caddy gestiona Let's Encrypt automáticamente.

### 11.6 `.env` de producción

`cp .env.production.example .env` y rellenar con Supabase + R2 + dominio:
```env
NODE_ENV=production

# Supabase — conexión directa IPv6 (NO el pooler)
DB_HOST=db.<project-ref>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_SSL=true
DB_USER_AUTH=auth_svc
DB_USER_USERS=users_svc
DB_USER_IMAGE=image_svc
DB_PASSWORD_AUTH=…
DB_PASSWORD_USERS=…
DB_PASSWORD_IMAGE=…

# Cloudflare R2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=emaseo-incidents
S3_REGION=auto
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_PUBLIC_URL=https://pub-<id>.r2.dev

# Dominios
PUBLIC_API_URL=https://micemaseo.duckdns.org
CORS_ORIGINS=https://micemaseo.duckdns.org,https://mic-emaseo-panel.pages.dev

# Modelo ML — copiar manualmente al VPS:
#   scp ML/modelos/rtdetr_l_best.pt root@<ip>:/opt/mic-emaseo/ML/modelos/
```

### 11.7 Levantar el stack

```bash
cd /opt/mic-emaseo
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
curl -sS https://micemaseo.duckdns.org/health   # → {"status":"ok"}
```

La primera build tarda 10–15 min (PyTorch + ultralytics es el cuello de botella). Las siguientes son incrementales.

### 11.8 Panel supervisor en Cloudflare Pages

Como el repo está bajo otra cuenta de GitHub, se usa `wrangler` desde la máquina del desarrollador:

```bash
cd Frontend/supervisor-panel
npm install
VITE_API_URL=https://micemaseo.duckdns.org/api npm run build
npx wrangler login          # 1 vez
npx wrangler pages project create mic-emaseo-panel --production-branch=main
npx wrangler pages deploy dist --project-name=mic-emaseo-panel --branch=main
```

Tras el deploy, agregar la URL `https://mic-emaseo-panel.pages.dev` a `CORS_ORIGINS` del backend y reiniciar el gateway.

### 11.9 APK móvil con EAS Build

```bash
cd Frontend/smart-waste-mobile
# Asegúrate de que .env.production tenga EXPO_PUBLIC_API_URL=https://micemaseo.duckdns.org/api
npx eas-cli login
npx eas-cli init --non-interactive --force      # crea el proyecto en expo.dev
npx eas-cli build --profile preview --platform android --non-interactive --no-wait
```

> **Nota sobre monorepo + EAS:** el repo monorepo (con `ML/` de 13 GB) hace que EAS suba 8 GB de tarball y rechace el build. La solución es **copiar la carpeta `smart-waste-mobile/` a un directorio aislado**, hacer `git init` allí, `npm install` y luego correr `eas build` desde esa copia. Esto deja el upload en ~1 MB. Ver detalle en el commit asociado al `.easignore`.

`eas.json` con perfil `preview` que genera APK directo (no AAB):
```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://micemaseo.duckdns.org/api" }
    }
  }
}
```

Cuando el build termina (10–25 min en cola gratuita), `expo.dev` da una URL de descarga directa del `.apk`.

---

## 12. Variables de entorno

Dos archivos coexisten:

- **`.env`** — desarrollo local con Docker Compose. Generado por `scripts/generate_env.sh` con secretos aleatorios. Ver `.env.example`.
- **`.env.production.local`** — producción (ignorado por git vía `.env.*.local`). Plantilla en `.env.production.example`.

| Variable | Descripción | Ejemplo |
|---|---|---|
| `POSTGRES_PASSWORD` | Superusuario Postgres (solo dev) | `openssl rand -base64 24` |
| `DB_HOST` / `DB_PORT` | Host y puerto de la DB | dev: `postgres`/`5432`; prod: `db.<ref>.supabase.co`/`5432` |
| `DB_NAME` | Nombre de la DB | dev: `MIC-EMASEO`; prod: `postgres` |
| `DB_SSL` | Conexión TLS a Postgres | `false` (dev) / `true` (prod) |
| `DB_USER_AUTH/USERS/IMAGE` | Usuario de cada microservicio | `auth_svc`, `users_svc`, `image_svc` |
| `DB_PASSWORD_AUTH/USERS/IMAGE` | Password de cada rol | `openssl rand -base64 32` |
| `JWT_SECRET` | Firma de access tokens | `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | TTL del access token | `15m` |
| `BCRYPT_ROUNDS` | Cost factor bcrypt | `10` (dev) / `12` (prod) |
| `INTERNAL_TOKEN` | Token entre microservicios | `openssl rand -base64 32` |
| `REDIS_PASSWORD` | Password de Redis | `openssl rand -base64 24` |
| `REDIS_PASSWORD_ENCODED` | Idem URL-encoded (`+`→`%2B`, `/`→`%2F`, `=`→`%3D`) — Flower lo necesita | Ver nota |
| `MINIO_ROOT_PASSWORD` | Root MinIO (solo dev) | `openssl rand -base64 24` |
| `S3_ENDPOINT` | Endpoint S3 | dev: `http://minio:9000`; prod: `https://<acct>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | Bucket | `emaseo-incidents` |
| `S3_REGION` | Región | dev: `us-east-1`; prod: `auto` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credenciales S3/R2 | — |
| `S3_PUBLIC_URL` | URL pública para servir imágenes | dev: `http://<ip-lan>:9000`; prod: `https://pub-<id>.r2.dev` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | SMTP para OTP. Gmail requiere App Password de 16 chars. | — |
| `PUBLIC_API_URL` | URL pública de la API | `https://micemaseo.duckdns.org` |
| `CORS_ORIGINS` | Orígenes permitidos (coma-separados) | `https://mic-emaseo-panel.pages.dev` |
| `DUMMY_MODE` | `true` simula respuestas del ML sin cargar el modelo | `false` |
| `PRE_CHECK_THRESHOLD` | Umbral del pre-check de basura | `0.35` |
| `FLOWER_USER` / `FLOWER_PASSWORD` | Acceso al dashboard Flower | — |
| `REGISTRY` / `TAG` | Para imágenes pre-construidas en GHCR | `ghcr.io/jsmena5` / `latest` |

---

## 13. Flujos principales

### 13.1 Reporte de incidente (pipeline asíncrono con 4 decisiones)

```
App móvil
  → POST /api/image/analyze  (base64 + lat/lon)
      → API Gateway: JWT + imageLimiter
          → Image Service:
              sharp (magic bytes, dimensiones)
              INSERT incidents estado=PROCESANDO
              ← 202 { task_id, poll_url }   ← respuesta inmediata

              [Celery via Redis]
              → POST ml-api:8000/predict
              ← decision_automatica + detecciones + effective_ratio

              switch decision_automatica:
                INCIDENTE_VALIDO   → R2 putObject + transacción:
                                       UPDATE incidents estado=PENDIENTE prioridad
                                       INSERT incident_images + analysis_results
                REVISION_REQUERIDA → R2 putObject (imagen_auditoria_url)
                                       UPDATE incidents estado=EN_REVISION
                RECHAZO_CONFIABLE  → R2 putObject (preservar)
                                       UPDATE incidents estado=DESCARTADO
                ERROR_TECNICO      → UPDATE incidents estado=FALLIDO nota_fallo

  ← App sondea GET /api/image/status/:task_id  (backoff 500 ms → 8 s)
      ← 202 PROCESANDO
      ← 200 estado_final + metadata (nivel, volumen, tipo, decision_automatica)

  [Cancelación del usuario]
      → task_id queda en AsyncStorage
      → HistorialScreen auto-polling cada 5 s mientras existan PROCESANDO
```

### 13.2 Wizard del supervisor (3 pasos)

```
Bandeja → click en card de incidente PENDIENTE
   ↓
Step1Validate
   ¿Es real?
   ├─ ❌ Descartar (motivo obligatorio) → estado RECHAZADA (fin)
   └─ ✅ Es real → siguiente paso
                          ↓
                    Step2Classify
                       Formulario ReviewCard:
                          es_correcta_ia (boolean firmado)
                          + nivel_acumulacion_supervisor (si IA estaba mal)
                          + tipo_residuo_supervisor (si IA estaba mal)
                          + nota_supervision
                       → PUT /supervisor/incidents/:id/revision-ia
                                  ↓
                            Step3Assign
                               Select operario + notas
                               → POST /supervisor/incidents/:id/asignar
                               → estado EN_ATENCION
```

Si el incidente entra al wizard ya en estado `EN_REVISION` (por decisión `REVISION_REQUERIDA` del ML), el wizard arranca en paso 1; si está `DESCARTADO` y el supervisor lo abre, el paso 1 pre-marca "Descartar".

### 13.3 Autenticación

```
POST /api/auth/login
  → bcrypt.compare(password, hash)
  → genera access_token (15 min) + refresh_token (64 bytes) → SHA-256 → INSERT
  ← { access_token, refresh_token }

POST /api/auth/refresh
  → SHA-256(token) → busca, valida, rota
  ← { access_token, refresh_token }
```

### 13.4 Recuperación de contraseña (3 pasos)

```
1. POST /api/auth/forgot-password    → OTP 6 dígitos (bcrypt en DB, TTL 15 min) → email
2. POST /api/auth/verify-reset-otp   → valida OTP
3. POST /api/auth/reset-password     → UPDATE password en transacción atómica
                                       ← { token: JWT }   ← login automático en la app
```

---

## 14. Usuarios de prueba

### Producción

| Email | Rol | Notas |
|---|---|---|
| `bryanfamiliat@gmail.com` | SUPERVISOR | Único usuario creado manualmente en Supabase para validar el panel |

Para crear más usuarios en producción, registrar desde la app móvil (CIUDADANO) o vía SQL en Supabase para staff.

### Desarrollo (seed `02_seed_data.sql`)

Contraseña común: `Test1234!`

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
├── .env                          ← Dev local (NO commitear)
├── .env.example                  ← Plantilla dev
├── .env.production.example       ← Plantilla prod
├── .env.production.local         ← Prod real (NO commitear, .env.*.local en .gitignore)
├── docker-compose.yml            ← Stack dev (11 contenedores, name: emaseo)
├── docker-compose.dev.yml        ← Overlay: expone MinIO/Redis/Flower
├── docker-compose.prod.yml       ← Stack prod (sin Postgres ni MinIO, IPv6 habilitado)
├── start.ps1 / start.sh          ← Scripts de arranque dev
├── scripts/
│   └── generate_env.sh           ← Genera .env con secretos aleatorios
├── deploy/
│   ├── Caddyfile                 ← Plantilla de reverse proxy para el VPS
│   └── README.md                 ← Guía de despliegue
├── Backend/
│   ├── api-gateway/              ← Express + JWT + Rate Limit + RBAC + Swagger
│   ├── auth-service/             ← OTP, refresh tokens, recuperación, anti-enumeración
│   ├── users-service/            ← CRUD perfiles + staff (operarios/supervisores)
│   ├── image-service/            ← Pipeline 4-decisiones + Circuit Breaker + recovery
│   │   └── src/controllers/
│   │       ├── supervisor.controller.js   ← endpoints /supervisor/*
│   │       └── feedback.controller.js     ← endpoints /operario/feedback/*
│   ├── ml-service/               ← FastAPI + Celery + RT-DETR-L (effective_ratio, decisiones)
│   └── database/                 ← 28 migraciones (01_init → 034_fix_image_urls) + 012 script roles
├── Frontend/
│   ├── smart-waste-mobile/       ← Expo SDK 54 (CIUDADANO/OPERARIO)
│   │   └── src/screens/          ← Scan, Historial, ScanResult, ReportDetail, ResetPassword, …
│   └── supervisor-panel/         ← React 19 + Vite 8 + Tailwind 4
│       └── src/features/incidents/
│           ├── IncidentsPage.tsx        ← orquestador
│           ├── IncidentRail.tsx         ← lista lateral
│           ├── FiltersBar.tsx           ← filtros (decision_automatica, fecha, ia_incorrecta, …)
│           ├── Stepper.tsx              ← wizard 3 pasos
│           ├── Step1Validate.tsx        ← ¿es real?
│           ├── Step2Classify.tsx        ← validar IA + corrección
│           ├── Step3Assign.tsx          ← asignar operario
│           ├── CaseTimeline.tsx         ← timeline unificado
│           └── styles.ts                ← paleta/constantes centralizadas
├── ML/
│   ├── modelos/                  ← rtdetr_l_best.pt (63 MB, ignorado por git)
│   ├── scripts/                  ← 01_descargar_taco … 06_agregar_taco
│   └── resultados/               ← Métricas comparativas y curvas
├── tests/                        ← test-integration.js
├── tools/                        ← start-tunnel.{ps1,sh}
└── docs/                         ← Documentación interna
```

---

## 16. Migraciones y cambios destacables

| # | Archivo | Descripción |
|---|---|---|
| 01 | `01_init_schema.sql` | Esquema inicial completo (schemas, ENUMs, tablas, índices, triggers) |
| 02 | `02_seed_data.sql` | Datos de prueba (solo dev) |
| 008 | `008_refresh_tokens.sql` | Tabla `refresh_tokens` con SHA-256 |
| 009 | `009_password_reset_tokens.sql` | OTP de recuperación con bcrypt |
| 010 | `010_incident_status_async.sql` | Añade `PROCESANDO` y `FALLIDO` al ENUM de estados |
| 011 | `011_consolidation.sql` | Triggers, funciones auxiliares, consolidación |
| 012 | `012_db_users_isolation.{sql,sh}` | Roles `auth_svc` / `users_svc` / `image_svc` con GRANTs mínimos |
| 014 | `014_initial_status_history.sql` | Trigger AFTER INSERT para registrar estado inicial |
| 015 | `015_missing_indexes.sql` | Índices faltantes detectados en perfilado |
| 016 | `016_data_validation.sql` | Constraints de validación (cédula, ubicación dentro de Ecuador, etc.) |
| 017 | `017_audit_schema.sql` | Schema `audit` + función SECURITY DEFINER + particiones mensuales |
| 018 | `018_device_tokens.sql` | Tokens FCM/APNs para push |
| 019 | `019_notifications_retry.sql` | Reintentos de notificaciones con backoff |
| 020 | `020_pending_registrations_to_auth.sql` | Mueve `pending_registrations` de `public` a `app_auth` (entonces `auth`) |
| 021 | `021_partition_incidents.sql` | Particionamiento de incidents (no aplicado en prod actualmente) |
| 022 | `022_lopdp_arco_functions.sql` | Funciones ARCO (LOPDP — derechos de acceso/rectificación/cancelación/oposición) |
| 023 | `023_user_consents.sql` | Registro de consentimiento LOPDP por versión de política |
| 024 | `024_pgcrypto_pii.sql` | Cifrado de PII con pgcrypto |
| 025 | `025_rls_image_svc.sql` | Row Level Security en tablas del image-service |
| 026 | `026_retention_policy.sql` | Política de retención (limpieza de imágenes huérfanas y notificaciones antiguas) |
| 027 | `027_fix_chk_prioridad_requerida.sql` | Corrige el CHECK de prioridad para los nuevos estados |
| 028 | `028_add_ubicacion_aproximada.sql` | Columna `ubicacion_aproximada` para GPS no disponible |
| 029 | `029_celery_task_id.sql` | Columna `celery_task_id` para recovery |
| 030 | `030_analysis_feedback.sql` | Tabla `ai.analysis_feedback` (feedback binario de operarios) |
| 031 | `031_notifications_push_index.sql` | Índice parcial para el push-worker |
| **032** | `032_human_review_flow.sql` | **Nuevos estados `EN_REVISION` y `DESCARTADO` + columnas `decision_automatica`, `confianza_decision`, `imagen_auditoria_url`. Resuelve el problema de imágenes eliminadas al rechazar.** |
| **033** | `033_supervisor_ia_corrections.sql` | **Correcciones supervisoras estructuradas en `ai.analysis_results` (`ia_fue_correcta`, `*_supervisor`, autoría). Alimenta drift detection.** |
| 034 | `034_fix_image_urls.sql` | Data-fix para normalizar URLs de imágenes |

**Cambios significativos no estrictamente "de migración":**
- **Rename `auth` → `app_auth`** (commit `159d45b`) — 9 archivos del backend actualizados para evitar colisión con `auth.users` de Supabase. La DB local también renombrada para no divergir.
- **Wizard de 3 pasos en el supervisor-panel** (sprint 3.5) — refactor de `pages/Reports.tsx` (1500 líneas monolíticas) a `features/incidents/*` con `Step1Validate`/`Step2Classify`/`Step3Assign`.
- **KPI cards en Home del panel** — 4 indicadores en vivo (Pendientes, En revisión, Asignados hoy, Resueltos hoy) + 5 críticas recientes.
- **Sidebar tablet-first** — colapsable 80 ↔ 224 px, sin logo gigante, navegación por iconos.
- **Tipos compartidos `incident.ts`** duplicados intencionalmente en `Frontend/supervisor-panel/src/types/` y `Frontend/smart-waste-mobile/src/types/` (decisión tomada al detectar que builds aislados — Docker, Pages — no pueden importar fuera del project root sin monorepo formal).

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

> Este sistema no está afiliado oficialmente a EMASEO EP. Los datos en producción son de demostración. Las credenciales de servicios cloud (Supabase, R2, DuckDNS, EAS, Contabo) viven exclusivamente en `.env.production.local` (fuera de git) y `.deploy_creds.local`.
