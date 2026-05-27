# MIC EMASEO — Sistema de Gestión Inteligente de Residuos Urbanos

> **v2.1 — Modelo ML Activo · Pipeline Asíncrono · Seguridad Reforzada**  
> Plataforma de detección y gestión de acumulación de basura para **EMASEO EP** (Quito, Ecuador).  
> Los ciudadanos reportan mediante foto + GPS; la IA clasifica el nivel de acumulación; supervisores y operarios gestionan la respuesta.

---

## Índice

1. [Características Principales](#1-características-principales)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Microservicios Backend](#4-microservicios-backend)
5. [Modelo de Machine Learning](#5-modelo-de-machine-learning)
6. [Infraestructura Docker](#6-infraestructura-docker)
7. [Frontend — Aplicación Móvil y Panel Web](#7-frontend--aplicación-móvil-y-panel-web)
8. [Esquema de Base de Datos](#8-esquema-de-base-de-datos)
9. [Seguridad](#9-seguridad)
10. [Testing y Calidad de Código](#10-testing-y-calidad-de-código)
11. [Inicio Rápido](#11-inicio-rápido)
12. [Variables de Entorno](#12-variables-de-entorno)
13. [Flujos Principales](#13-flujos-principales)
14. [Usuarios de Prueba](#14-usuarios-de-prueba)
15. [Estructura del Proyecto](#15-estructura-del-proyecto)
16. [Licencia y Créditos](#16-licencia-y-créditos)

---

## 1. Características Principales

- **Reporte ciudadano con foto + GPS** — La app móvil captura la imagen y las coordenadas geográficas con un solo gesto.
- **Detección con IA (RT-DETR-L v2, mAP@50 = 0.8802)** — Modelo transformer entrenado en GPU sobre 12 180 imágenes; +85 % de mejora respecto al baseline.
- **Clasificación de nivel y volumen** — BAJO / MEDIO / ALTO / CRÍTICO con volumen estimado en m³.
- **Rechazo amigable** — Si la IA no detecta basura, la imagen se elimina de MinIO y el ciudadano recibe un mensaje legible (sin registros huérfanos en BD).
- **Pipeline asíncrono (202 + polling con backoff)** — La respuesta HTTP llega inmediatamente; el cliente sondea con backoff exponencial (500 ms → 8 s). El usuario puede cancelar la espera y el análisis continúa en segundo plano.
- **Seguimiento en segundo plano** — Si el usuario cancela la espera, el `task_id` se guarda en AsyncStorage y la pantalla de Historial muestra el resultado cuando esté listo (auto-polling cada 5 s).
- **Circuit Breaker sobre el ML Service** — Degrada elegantemente ante fallos del servicio de inferencia sin colgar el Image Service.
- **Asignación automática por zona geográfica** — PostGIS asigna el operario más cercano según polígonos EPSG:4326.
- **Panel de supervisor (web)** — Listado, detalle, cambio de estado, asignación de operarios y estadísticas por zona.
- **Microservicios aislados** — Cada servicio tiene su propio rol de BD con mínimo privilegio; comunicación interna autenticada por token.
- **Recuperación periódica de tareas** — Un worker de recovery retoma tareas Celery huérfanas en estado PROCESANDO cada 30 segundos.

---

## 2. Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| API Gateway | Node.js / Express + Helmet + pino | 18+ |
| Auth Service | Node.js / Express + bcryptjs + nodemailer + pino | 18+ |
| Users Service | Node.js / Express + pino | 18+ |
| Image Service | Node.js / Express + AWS SDK v3 + opossum (CB) + sharp | 18+ |
| ML API | Python / FastAPI + Gunicorn + Uvicorn workers | 3.11 |
| ML Worker | Celery + Ultralytics RT-DETR | 3.11 |
| Base de datos | PostgreSQL 16 + PostGIS 3.4 + pgcrypto | Docker |
| Object Storage | MinIO (dev) / AWS S3 (prod) | Docker |
| Message Broker | Redis 7 (requirepass) | Docker |
| Task Dashboard | Flower 2.0 | Docker |
| App móvil | React Native / Expo SDK 54 + TypeScript | — |
| Panel web | React + Vite + TypeScript | — |
| Modelo IA | RT-DETR-L v2 (`rtdetr_l_best.pt`) — mAP@50=0.880 | Ultralytics |
| Seguridad HTTP | Helmet, express-rate-limit, CORS | — |
| Logs | pino (JSON estructurado, log levels) | — |
| Documentación API | swagger-jsdoc + swagger-ui-express | — |

---

## 3. Arquitectura del Sistema

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              CLIENTES                                     │
│   📱 React Native / Expo (ciudadano, operario)   🖥  React + Vite (sup.) │
└─────────────────────────────┬────────────────────────────────────────────┘
                              │  HTTPS (LAN / Cloudflare Tunnel / Ngrok)
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      API GATEWAY :4000  [Docker]                          │
│  Helmet · CORS · JWT (15 min) · Rate Limit · RBAC · pino · Swagger UI    │
│  X-Internal-Token inyectado en cada petición a microservicios             │
└────────┬──────────────────┬──────────────────┬───────────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
    Auth Service       Users Service      Image Service      [Docker — sin
       :3002              :3000              :5000             puertos expuestos]
         │                  │                  │
         └──────────────────┴──────────────────┘
                            │  SQL (roles de mínimo privilegio)
                            ▼
          ┌─────────────────────────────────────┐
          │  PostgreSQL 16 + PostGIS 3.4         │  :5432 (solo red interna)
          │  pgcrypto · RLS · auditoria triggers │
          └─────────────────────────────────────┘

          ┌─────────────────────────────────────┐
          │  MinIO (S3-compatible)               │  :9000/:9001 (dev opcional)
          │  Bucket: emaseo-incidents (público)  │
          └─────────────────────────────────────┘

          ┌─────────────────────────────────────┐
          │  Redis 7 (requirepass)               │  :6379 (solo red interna)
          │  Broker + Result Backend de Celery   │
          └──────────────────┬──────────────────┘
                             │ Celery tasks
               ┌─────────────┴──────────────┐
               ▼                            ▼
        ┌─────────────┐            ┌─────────────────┐
        │  ML API      │            │  ML Worker(s)    │
        │  FastAPI +   │            │  Celery + RTDETR │
        │  Gunicorn    │            │  GPU/CPU         │
        └─────────────┘            └─────────────────┘

          ┌─────────────────────────────────────┐
          │  Flower :5555  (dashboard Celery)    │  :5555 (dev opcional)
          └─────────────────────────────────────┘
```

### Comunicación entre servicios

- El **API Gateway** es el único punto de entrada externo; los microservicios no exponen puertos al host.
- El Gateway inyecta `X-Internal-Token` en cada petición; los servicios rechazan con 403 cualquier llamada sin él.
- El **Image Service** llama al **ML API** internamente (`http://ml-api:8000/predict`), protegido por un Circuit Breaker (opossum).
- La inferencia ML corre de forma asíncrona en el **ML Worker** via Celery; el resultado se recoge mediante polling con backoff exponencial (500 ms → 8 s).

---

## 4. Microservicios Backend

### API Gateway `:4000`

Punto de entrada único. Responsabilidades:

- **Proxy HTTP** a microservicios upstream via `http-proxy-middleware`.
- **Validación JWT** (access token, 15 min) en rutas protegidas antes de reenviar la petición.
- **RBAC**: `requireCiudadano`, `requireSupervisor`, `requireStaff`, `requireAdmin` según el rol.
- **Rate limiting granular**: global 100 req/15 min; login 5/15 min; OTP 10/15 min; imagen 20/hora; forgot-password 5/hora.
- **Helmet** y **CORS** configurados (origins via variable de entorno).
- **Swagger UI** en `/api-docs` (spec generado con swagger-jsdoc).
- **`trust proxy 1`** — necesario para leer la IP real detrás de Cloudflare Tunnel / Ngrok.

### Auth Service `:3002`

Maneja identidad y sesiones:

| Endpoint | Descripción |
|----------|-------------|
| `POST /api/auth/login` | Devuelve `access_token` (15 min) + `refresh_token` (7 días, hash SHA-256 en DB) |
| `POST /api/auth/refresh` | Rota el refresh token (rotación de token único) |
| `POST /api/auth/logout` | Revoca el refresh token |
| `POST /api/auth/forgot-password` | OTP de 6 dígitos (15 min), **hash bcrypt almacenado en DB** |
| `POST /api/auth/verify-reset-otp` | Valida el OTP hasheado |
| `POST /api/auth/reset-password` | Actualiza contraseña en transacción atómica; marca OTP como usado; devuelve JWT listo para usar |
| `POST /api/auth/register` | Inicia registro (paso 1) — INSERT en `pending_registrations` + OTP por email |
| `POST /api/auth/verify-otp` | Verifica OTP de registro (paso 2) |
| `POST /api/auth/set-password` | Finaliza registro: INSERT `auth.users` + `public.ciudadanos` (paso 3) |

**Seguridad anti-enumeración:** login devuelve el mismo mensaje "Credenciales incorrectas" tanto si el email no existe como si la contraseña es incorrecta. No es posible descubrir qué emails están registrados.

### Users Service `:3000`

CRUD de perfiles (ciudadanos, operarios, supervisores). Avatar, datos de contacto y gestión de estado de cuenta.

### Image Service `:5000`

Orquestador del flujo de reporte:

```
1. Validación de imagen (sharp):
   ├─ Magic bytes (JPEG: FF D8 / PNG: 89 50 4E 47)
   ├─ Dimensiones mínimas: 320 × 320 px
   └─ Tamaño mínimo: 1 KB (anti-polyglot)

2. INSERT incidents estado=PROCESANDO
   ← 202 { task_id, poll_url }  ← respuesta inmediata al cliente

3. [background — setImmediate]
   → Circuit Breaker → POST ml-api:8000/predict (imagen base64)
   ← has_waste === false
       → UPDATE estado=FALLIDO (sin imagen en MinIO)
   ← has_waste === true
       → PutObject MinIO → incidents/{uuid}.jpg
       → Transacción PostgreSQL atómica:
           UPDATE incidents estado=PENDIENTE prioridad=<IA>
           INSERT incidents.incident_images  (URL pública MinIO)
           INSERT ai.analysis_results        (JSONB detecciones)

4. GET /api/image/status/:task_id (polling por el cliente)
   ← 202 PROCESANDO | 200 FALLIDO | 200 PENDIENTE (con metadata)
```

**Recovery periódico**: cada 30 segundos se revisan incidentes en estado PROCESANDO por más de 3 minutos y se intenta recuperar su tarea Celery.

---

## 5. Modelo de Machine Learning

**Archivo:** `Backend/ml-service/main.py`  
**Pesos:** `ML/modelos/rtdetr_l_best.pt` (RT-DETR-L v2, 63 MB)  
**Framework:** FastAPI + Ultralytics + Celery  
**Arquitectura:** RT-DETR-L, 32.8 M parámetros, backbone ResNet-101D

### Métricas (RT-DETR-L v2 vs v1)

| Métrica | v1 (CPU baseline) | v2 (producción) | Mejora |
|---------|------------------|-----------------|--------|
| mAP@50 | 0.4752 | **0.8802** | +85.2% |
| mAP@50:95 | 0.2450 | **0.6069** | +147.7% |
| Precision | 0.5523 | **0.8840** | +60.1% |
| Recall | 0.4353 | **0.8203** | +88.5% |

> Evaluado sobre conjunto de validación (623 imágenes). Best checkpoint: epoch 64/100 con GPU T4, AdamW, lr=0.0001, batch=16.  
> Ver tabla comparativa completa en [`ML/resultados/README.md`](ML/resultados/README.md).

### Dataset

**1 clase** (`garbage`) — 12 180 imágenes totales (11 557 train / 623 val)  
Fuente: *Garbage Collector v8* — Roboflow Universe

### Pipeline de inferencia

```
Imagen base64 → Decodificación PIL
    → RTDETR.predict(conf=0.35, iou=0.50)
    → Filtro whitelist de clases (RECICLABLE, ORGANICO, ESCOMBROS, PELIGROSO, MIXTO, ...)
    → Filtro área < 0.5% del frame (ruido)
    → Sin detecciones válidas  → has_waste: false  (Rechazo Amigable)
    → Con detecciones  → cálculo effective_ratio
        ├─ conf_factor  = min(1.0, conf_media / 0.60)
        ├─ det_factor   = min(1.0, 0.40 + 0.20 × num_detecciones)
        ├─ ISOLATION_PENALTY × 0.65 (si 1 objeto > 55% del frame)
        └─ class_weight (PELIGROSO ×1.30 … RECICLABLE ×0.85)
```

### Bandas de clasificación

| `effective_ratio` | Nivel | Prioridad | Volumen estimado |
|-------------------|-------|-----------|-----------------|
| 0.00 – 0.15 | BAJO | BAJA | 0.1 – 0.5 m³ |
| 0.15 – 0.40 | MEDIO | MEDIA | 0.5 – 2.0 m³ |
| 0.40 – 0.70 | ALTO | ALTA | 2.0 – 5.0 m³ |
| 0.70 – 1.00 | CRÍTICO | CRÍTICA | 5.0 – 15.0 m³ |

### Nota técnica — URL encoding de Redis

El `REDIS_PASSWORD` generado con `openssl rand -base64 24` contiene caracteres especiales (`+`, `/`) que son reservados en URLs. El archivo `celery_app.py` construye la URL de conexión usando `urllib.parse.quote(password, safe='')` para codificarlos correctamente antes de armar la cadena `redis://:PASS@host:port/db`. Flower (imagen pre-compilada) usa la variable `REDIS_PASSWORD_ENCODED` (con `+`→`%2B`, `/`→`%2F`) ya que no tiene acceso al código Python.

---

## 6. Infraestructura Docker

Todo el sistema corre dentro de Docker con **nombre de proyecto fijo `emaseo`** (`name: emaseo` en `docker-compose.yml`). Esto garantiza que los volúmenes siempre se llamen `emaseo_postgres_data`, `emaseo_minio_data`, etc., sin importar el directorio desde el que se ejecute el comando.

El único puerto publicado al host por defecto es el **4000** del API Gateway.

| Contenedor | Imagen / Build | Función | Puerto host |
|-----------|---------------|---------|-------------|
| `emaseo-postgres` | `postgis/postgis:16-3.4` | BD + extensiones geoespaciales | 5432 |
| `emaseo-minio` | `minio/minio:latest` | Object Storage S3-compatible | 9000, 9001 (\*) |
| `emaseo-minio-init` | `minio/mc:latest` | Crea bucket y permisos (efímero, se detiene solo) | — |
| `emaseo-redis` | `redis:7-alpine` | Broker + result backend Celery | 6379 (\*) |
| `emaseo-auth` | Build `./Backend/auth-service` | Autenticación y sesiones | — |
| `emaseo-users` | Build `./Backend/users-service` | CRUD de perfiles | — |
| `emaseo-image` | Build `./Backend/image-service` | Orquestador de reportes | — |
| `emaseo-gateway` | Build `./Backend/api-gateway` | API Gateway (único acceso externo) | **4000** |
| `emaseo-ml-api` | Build `./Backend/ml-service` | API ML (Gunicorn + Uvicorn) | — |
| `emaseo-ml-worker-1` | Build `./Backend/ml-service` | Worker Celery (inferencia RT-DETR GPU/CPU) | — |
| `emaseo-flower` | `mher/flower:2.0` | Dashboard de tareas Celery | 5555 (\*) |

> (\*) Solo publicados en `127.0.0.1` cuando se usa `docker-compose.dev.yml` (con `-f docker-compose.dev.yml`).

> **`emaseo-minio-init`** aparece como "Exited" en Docker Desktop una vez que termina de crear el bucket — esto es normal y esperado. No es un error.

**Volúmenes persistentes:** `emaseo_postgres_data`, `emaseo_minio_data`, `emaseo_redis_data`, `emaseo_shared_uploads`  
**Red interna:** `emaseo_network` (bridge) — los contenedores se comunican por nombre de servicio.  
**Healthchecks:** todos los servicios con `depends_on: condition: service_healthy`.  
**Escalado ML:** `docker compose up -d --scale ml-worker=N` para N réplicas del worker Celery.

---

## 7. Frontend — Aplicación Móvil y Panel Web

### App Móvil — `Frontend/smart-waste-mobile/`

**Stack:** React Native (Expo SDK 54) + TypeScript + SecureStore

| Pantalla | Descripción |
|----------|-------------|
| Login / Register | Wizard de 3 pasos: datos → OTP email → contraseña |
| ForgotPassword | Recuperación por OTP con flujo seguro de 3 pasos |
| ResetPassword | Nueva contraseña; al completar llama `login(token)` para cambiar al grupo privado automáticamente |
| ScanScreen | Cámara + GPS; permisos secuenciales; animación de escaneo; timeout 110 s; cancel guarda task_id en AsyncStorage |
| ScanResult | Resultado del análisis IA (nivel, volumen, tipo, confianza) |
| Historial | Lista de reportes; auto-polling cada 5 s si hay incidentes en estado PROCESANDO |
| ReportDetail | Mapa interactivo + geocoding inverso + foto MinIO |
| Perfil | Datos del ciudadano autenticado |

**Seguridad móvil:** tokens almacenados con **SecureStore** (no AsyncStorage); aborto de peticiones con `AbortController`; barra de progreso de upload; cancelación no bloqueante (el análisis continúa en segundo plano).

**Validación de contraseña (sincronizada con el backend):**
- Mínimo 8 caracteres
- Al menos 1 letra mayúscula
- Al menos 1 letra minúscula
- Al menos 1 dígito numérico

**Flujo de recuperación de contraseña:**
1. `ForgotPasswordScreen` — el usuario ingresa su email y recibe un OTP por correo
2. `OtpScreen` — verifica el OTP de 6 dígitos
3. `ResetPasswordScreen` — elige nueva contraseña; el backend devuelve un JWT listo y se llama `login(token)` para que `AppNavigator` cambie automáticamente al grupo privado (Home) sin necesidad de `navigation.reset()`

**Procesamiento en segundo plano:**
- Al cancelar el análisis en `ScanScreen`, el `task_id` se guarda en `AsyncStorage` bajo la clave `PROCESSING_TASKS_KEY`
- `HistorialScreen` detecta incidentes con `estado === "PROCESANDO"` y activa auto-polling cada 5 s
- El usuario puede cerrar la pantalla de escaneo y consultar el resultado en su historial cuando esté listo

### Panel de Supervisor — `Frontend/supervisor-panel/`

**Stack:** React 19 + Vite + TypeScript + Tailwind CSS 4 + React Leaflet  
No corre en Docker — se levanta como proceso de desarrollo local.

```bash
cd Frontend/supervisor-panel
npm install        # solo la primera vez
npm run dev        # → http://localhost:5173
```

**Variable de entorno:** `Frontend/supervisor-panel/.env`
```env
VITE_API_URL=http://localhost:4000/api   # desarrollo local
# VITE_API_URL=/api                      # producción (relativo)
```

**Funcionalidades:** listado y gestión de incidentes, cambio de estado, asignación de operarios, estadísticas por zona, revisión de decisiones IA (corrección de severidad/tipo), mapas interactivos con Leaflet.

---

## 8. Esquema de Base de Datos

**Motor:** PostgreSQL 16 + PostGIS 3.4 + pgcrypto  
**Scripts:** `Backend/database/` (montados en `docker-entrypoint-initdb.d`) — 31 migraciones numeradas

| Schema | Tablas principales |
|--------|-------------------|
| `auth` | `users`, `refresh_tokens`, `password_reset_tokens` |
| `public` | `ciudadanos` (perfil 1:1), `pending_registrations`, `user_consents` |
| `operations` | `operarios`, `zones` (polígonos PostGIS EPSG:4326) |
| `incidents` | `incidents`, `incident_images`, `status_history`, `assignments` |
| `ai` | `analysis_results` (JSONB detecciones, waste_type, accumulation_level) |
| `notifications` | `device_tokens`, `notifications`, `notifications_retry` |
| `audit` | Auditoría de acciones sensibles (triggers automáticos) |

**ENUMs clave:**

```sql
auth.user_role:            CIUDADANO | OPERARIO | SUPERVISOR | ADMIN
incidents.incident_status: PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA | PROCESANDO | FALLIDO
incidents.priority_level:  BAJA | MEDIA | ALTA | CRITICA
ai.waste_type:             DOMESTICO | ORGANICO | RECICLABLE | ESCOMBROS | PELIGROSO | MIXTO | OTRO
ai.accumulation_level:     BAJO | MEDIO | ALTO | CRITICO
```

**Índices geoespaciales:**

```sql
CREATE INDEX ON incidents.incidents USING GIST (ubicacion);
CREATE INDEX ON operations.zones    USING GIST (geom);
CREATE INDEX ON ai.analysis_results USING GIN  (detecciones);
```

**RLS activo** en tablas del image-service para que `image_svc` solo acceda a sus propias filas.  
**Particionamiento:** `incidents.incidents` particionado por `created_at` (mensual).  
**Retención:** política automática de limpieza de imágenes huérfanas y notificaciones antiguas.  
**Validación de cédula ecuatoriana:** función `fn_validar_cedula_ec()` implementa el algoritmo Módulo 10 del Registro Civil del Ecuador.

---

## 9. Seguridad

| Capa | Medida |
|------|--------|
| **Red** | Microservicios sin puertos expuestos; solo Gateway en :4000 |
| **Autenticación** | JWT (15 min) + Refresh Token rotatorio (7 días, hash SHA-256 en BD) |
| **Contraseñas** | bcrypt con cost factor 10; reglas: 8+ chars, mayúscula, minúscula, dígito |
| **Anti-enumeración** | Login devuelve el mismo mensaje para email inexistente y contraseña incorrecta |
| **OTP** | 6 dígitos, hash bcrypt en BD, TTL 15 min, un solo uso |
| **Comunicación interna** | `X-Internal-Token` en cada petición; 403 si falta |
| **HTTP Headers** | Helmet.js (CSP, HSTS, X-Frame-Options, etc.) |
| **CORS** | Origins configurables por variable de entorno |
| **Rate Limiting** | Granular por endpoint (global / login / OTP / imagen / forgot-password) |
| **Trust Proxy** | `app.set("trust proxy", 1)` en todos los servicios para leer IP real detrás de Cloudflare |
| **Validación de imágenes** | sharp: magic bytes, dimensiones mínimas, anti-polyglot |
| **Almacenamiento móvil** | SecureStore (cifrado del dispositivo) en lugar de AsyncStorage |
| **BD: mínimo privilegio** | Roles `auth_svc`, `users_svc`, `image_svc` con GRANT mínimos |
| **BD: RLS** | Row Level Security en tablas del image-service |
| **BD: cifrado PII** | pgcrypto para datos personales sensibles |
| **BD: auditoría** | Triggers de auditoría en acciones críticas |
| **Logs** | pino (JSON estructurado); campos `password/token/otp` saneados con `[REDACTED]` |
| **Circuit Breaker** | opossum sobre el ML Service (50 % errores / ventana 60 s) |

---

## 10. Testing y Calidad de Código

- **Tests**: Vitest — suites unitarias e integración en los servicios Node.js (`Backend/*/src/__tests__/`).
- **Linting**: ESLint + Prettier configurados en cada servicio Backend.
- **Logs estructurados**: pino en todos los servicios; niveles `info/warn/error/fatal`; request-id por petición.
- **OpenAPI**: Swagger UI vivo en `http://localhost:4000/api-docs`.

---

## 11. Inicio Rápido

> **Requisitos:** Docker Desktop instalado y corriendo. No se necesita Node.js ni Python para ejecutar el sistema completo.  
> Para la guía completa con todos los escenarios, ver [GUIA_EJECUCION.md](GUIA_EJECUCION.md).

### ① Backend completo (Docker — un solo comando)

**Windows (PowerShell):**
```powershell
.\start.ps1           # genera .env + construye imágenes + levanta 11 contenedores
.\start.ps1 -NoBuild  # inicio rápido (imágenes ya construidas)
.\start.ps1 -Build    # forzar reconstrucción (tras cambios en el código)
.\start.ps1 -Dev      # exponer MinIO :9001, Redis :6379, Flower :5555
```

**Linux / macOS / WSL:**
```bash
bash start.sh           # genera .env + construye + levanta
bash start.sh --no-build
bash start.sh --dev
```

**Manual:**
```bash
docker compose up -d --build   # primera vez
docker compose up -d           # sesiones posteriores
```

> **Nota Windows con espacios en la ruta:** `start.ps1` lo soluciona automáticamente. Si usas comandos manuales, crea primero una junction sin espacios:
> ```powershell
> cmd /c mklink /J C:\MIC-EMASEO-WORK "C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA"
> cd C:\MIC-EMASEO-WORK
> ```

### ② Panel de Supervisor (React + Vite)

```bash
cd Frontend/supervisor-panel
npm install        # solo la primera vez
npm run dev
# → Acceder en http://localhost:5173
```

Asegúrate de que `.env` del panel apunte al Gateway:
```env
# Frontend/supervisor-panel/.env
VITE_API_URL=http://localhost:4000/api
```

### ③ Túnel Cloudflare (acceso remoto desde datos móviles)

```powershell
# Windows — modo remoto completo (2 túneles + Expo automático)
.\start-remote.ps1

# Windows — backend + túnel API integrado
.\start.ps1 -Tunnel
```

```bash
# Linux / WSL — solo túnel API (actualiza .env.development automáticamente)
bash tools/start-tunnel.sh
```

### Acceder a los servicios

| Servicio | URL | Cuándo está disponible |
|---------|-----|----------------------|
| **API Gateway** | `http://localhost:4000` | Siempre (con Docker activo) |
| **Swagger UI** | `http://localhost:4000/api-docs` | Siempre (con Docker activo) |
| **Panel Supervisor** | `http://localhost:5173` | Con `npm run dev` activo |
| **MinIO Console** | `http://localhost:9001` | Con `-Dev` o `docker-compose.dev.yml` |
| **Flower (Celery)** | `http://localhost:5555` | Con `-Dev` o `docker-compose.dev.yml` |

---

## 12. Variables de Entorno

Todas las variables se gestionan desde un **único archivo `.env` en la raíz del proyecto**.

```bash
# Genera .env con valores aleatorios seguros (Linux/macOS/WSL)
bash scripts/generate_env.sh

# O copia el ejemplo y completa manualmente
cp .env.example .env
```

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `POSTGRES_PASSWORD` | Contraseña del superusuario PostgreSQL | `openssl rand -base64 24` |
| `DB_PASSWORD_AUTH/USERS/IMAGE` | Contraseñas de roles de servicio (mínimo privilegio) | `openssl rand -base64 24` |
| `JWT_SECRET` | Secreto para firmar access tokens (mín. 48 bytes) | `openssl rand -base64 48` |
| `JWT_EXPIRES_IN` | TTL del access token | `15m` |
| `MINIO_ROOT_PASSWORD` | Contraseña root de MinIO | `openssl rand -base64 24` |
| `REDIS_PASSWORD` | Contraseña de Redis (requirepass) | `openssl rand -base64 24` |
| `REDIS_PASSWORD_ENCODED` | Igual que REDIS_PASSWORD pero percent-encoded (`+`→`%2B`, `/`→`%2F`) — usado por Flower | Ver nota abajo |
| `INTERNAL_TOKEN` | Token de autenticación interna entre servicios | `openssl rand -base64 32` |
| `SMTP_HOST` | Servidor SMTP | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto SMTP | `587` |
| `SMTP_USER` | Email remitente | `tu@gmail.com` |
| `SMTP_PASS` | Contraseña SMTP (Gmail: App Password de 16 chars) | Ver nota abajo |
| `EMAIL_FROM` | Dirección From de los correos | `tu@gmail.com` |
| `DUMMY_MODE` | `false` = modelo real RT-DETR; `true` = respuesta simulada (sin `.pt`) | `false` |
| `EXPOSE_DEV_PORTS` | (legacy) `true` en `.env`; preferir `docker-compose.dev.yml` | `` (vacío) |
| `CORS_ORIGINS` | Orígenes CORS permitidos (coma-separados) | `http://localhost:5173` |
| `S3_PUBLIC_URL` | URL pública de MinIO — usar IP de red, no `localhost`, para acceso desde el móvil | `http://192.168.1.x:9000` |
| `FLOWER_USER` / `FLOWER_PASSWORD` | Credenciales de acceso al dashboard Flower | Secreto aleatorio |

### Gmail App Password (para SMTP)

Gmail requiere una contraseña de aplicación (no la contraseña de la cuenta):

1. Habilitar Verificación en 2 pasos en [myaccount.google.com](https://myaccount.google.com) → Seguridad
2. Ir a **Contraseñas de aplicaciones** → Generar → nombre: `EMASEO`
3. Copiar la clave de 16 caracteres generada en `SMTP_PASS` del `.env` (sin espacios)

### REDIS_PASSWORD_ENCODED (generación)

Si la contraseña de Redis contiene `+` o `/` (frecuente con `openssl rand -base64`), generar la versión encoded:

```powershell
# PowerShell
$pwd = "tu_redis_password_aqui"
[Uri]::EscapeDataString($pwd)
```

```bash
# Bash
python3 -c "import urllib.parse; print(urllib.parse.quote('tu_redis_password_aqui', safe=''))"
```

Ver [`env.example`](.env.example) para la lista completa con comentarios.

---

## 13. Flujos Principales

### Reporte de incidente (pipeline asíncrono con cancelación)

```
App móvil
  → POST /api/image/analyze  (base64 + lat/lon)
      → API Gateway: valida JWT + imageLimiter
          → Image Service:
              → sharp: magic bytes + dimensiones
              → INSERT incidents estado=PROCESANDO
              ← 202 { task_id, poll_url }   ← respuesta inmediata

              [setImmediate — background]
              → Circuit Breaker → POST ml-api:8000/predict
              ← has_waste: false → UPDATE estado=FALLIDO (sin MinIO)
              ← has_waste: true  → PutObject MinIO
                                  → Transacción atómica PostgreSQL
                                      UPDATE incidents estado=PENDIENTE
                                      INSERT incident_images + analysis_results

  ← App sondea GET /api/image/status/:task_id  (backoff 500 ms → 8 s)
      → 202 PROCESANDO
      → 200 FALLIDO   (sin imagen, mensaje descriptivo)
      → 200 PENDIENTE (nivel, volumen, tipo_residuo, url_imagen)

  [Si el usuario cancela]
      → task_id guardado en AsyncStorage
      → HistorialScreen auto-polling cada 5 s mientras haya PROCESANDO
      → resultado aparece automáticamente cuando el ML termina
```

### Autenticación y sesiones

```
POST /api/auth/login
  → bcrypt.compare(password, hash)
  → genera access_token JWT (15 min)
  → genera refresh_token (64 bytes) → SHA-256 → INSERT refresh_tokens
  ← { access_token, refresh_token }

POST /api/auth/refresh
  → SHA-256(token) → busca en DB → verifica no revocado y no expirado
  → DELETE viejo + INSERT nuevo refresh_token (rotación)
  ← { access_token, refresh_token }
```

### Recuperación de contraseña (3 pasos)

```
1. POST /api/auth/forgot-password  → OTP 6 dígitos (bcrypt en DB, TTL 15 min) → email al usuario
2. POST /api/auth/verify-reset-otp → valida OTP
3. POST /api/auth/reset-password   → actualiza contraseña (transacción atómica)
                                   ← { token: JWT }  ← login automático en la app
   App: login(token) → AuthContext actualiza → AppNavigator → grupo privado (Home)
```

### Registro ciudadano (3 pasos)

```
1. POST /api/auth/register   → INSERT pending_registrations + OTP email
2. POST /api/auth/verify-otp → valida OTP hasheado (TTL 15 min)
3. POST /api/auth/set-password → INSERT auth.users + ciudadanos (atómico)
                                → DELETE pending_registration
```

---

## 14. Usuarios de Prueba

Los siguientes usuarios están disponibles en el entorno de desarrollo (cargados por `Backend/database/02_seed_data.sql`).  
**Contraseña de todos:** `Test1234!`

| Email | Rol | Nombre |
|-------|-----|--------|
| `admin@emaseo.gob.ec` | ADMIN | Administrador Sistema |
| `maria.lopez@emaseo.gob.ec` | SUPERVISOR | María López |
| `pedro.garcia@emaseo.gob.ec` | OPERARIO | Pedro García |
| `luis.martinez@emaseo.gob.ec` | OPERARIO | Luis Martínez |
| `ana.ciudadana@gmail.com` | CIUDADANO | Ana Ciudadana |
| `jorge.ramirez@gmail.com` | CIUDADANO | Jorge Ramírez |

---

## 15. Estructura del Proyecto

```
MIC-EMASEO-SISTEMA/
├── .env                      ← Variables de entorno (NO commitear — en .gitignore)
├── .env.example              ← Plantilla de variables (sin secretos)
├── docker-compose.yml        ← Orquestación de los 11 contenedores (name: emaseo)
├── docker-compose.dev.yml    ← Overlay: expone puertos de MinIO, Redis y Flower
├── start.ps1                 ← Script de arranque Windows (-Tunnel, -Expo, -Dev, -Build, -NoBuild)
├── start.sh                  ← Script de arranque Linux/macOS/WSL
├── scripts/
│   └── generate_env.sh       ← Genera .env con secretos aleatorios seguros
├── Backend/
│   ├── api-gateway/          ← Express + JWT + Rate Limit + RBAC + Swagger
│   ├── auth-service/         ← Identidad, sesiones, OTP, refresh tokens, anti-enumeration
│   ├── users-service/        ← CRUD de perfiles
│   ├── image-service/        ← Pipeline de reportes + Circuit Breaker + recovery 30 s
│   ├── ml-service/           ← FastAPI + Celery + RT-DETR-L (celery_app.py con URL encoding)
│   └── database/             ← Scripts SQL de inicialización (31 migraciones)
├── Frontend/
│   ├── smart-waste-mobile/   ← Expo SDK 54 + TypeScript (ciudadano/operario)
│   │   └── src/screens/      ← ScanScreen, HistorialScreen, ResetPasswordScreen, …
│   └── supervisor-panel/     ← React + Vite (supervisor web)
├── ML/
│   ├── modelos/              ← rtdetr_l_best.pt (63 MB, no en git)
│   └── resultados/           ← Métricas comparativas y curvas de entrenamiento
└── docs/                     ← Documentación técnica interna
```

---

## 16. Licencia y Créditos

**Proyecto de Tesis — Maestría en Ingeniería de Software**  
Universidad de las Fuerzas Armadas ESPE — 2026  

**Entidad beneficiaria:** EMASEO EP (Empresa Pública Metropolitana de Aseo, Quito)  

**Equipo de desarrollo:**  
- Bryan Ortiz — Arquitectura, Backend, ML, Seguridad, App Móvil

**Dataset:** [Garbage Collector v8 — Roboflow Universe](https://universe.roboflow.com/garbage-epywh/garbage-collector-qcgu1)  
**Modelo base:** RT-DETR-L — PaddlePaddle / Ultralytics  

> Este sistema no está afiliado oficialmente a EMASEO EP. Los datos de producción son confidenciales y no se incluyen en este repositorio.
