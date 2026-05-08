# Sistema de Gestión de Residuos Urbanos — MIC EMASEO

> Plataforma de detección y gestión de acumulación de basura para **EMASEO EP** (Quito, Ecuador).  
> Ciudadanos reportan mediante foto; la IA analiza la acumulación; supervisores y operarios gestionan la respuesta.

---

## Índice

1. [Visión General](#1-visión-general)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Stack Tecnológico](#3-stack-tecnológico)
4. [Microservicios Backend](#4-microservicios-backend)
5. [Servicio ML — RT-DETR-L](#5-servicio-ml--rt-detr-l)
6. [Infraestructura Docker](#6-infraestructura-docker)
7. [Frontend — Aplicación Móvil](#7-frontend--aplicación-móvil)
8. [Esquema de Base de Datos](#8-esquema-de-base-de-datos)
9. [Flujos Principales](#9-flujos-principales)

---

## 1. Visión General

El sistema conecta tres roles de usuario en un flujo completo de gestión de incidentes:

| Rol | Plataforma | Función principal |
|-----|-----------|------------------|
| **Ciudadano** | App móvil (Expo) | Fotografía, geolocaliza y reporta acumulaciones de basura |
| **Supervisor** | Panel web (React + Vite) | Revisa reportes, asigna operarios, cierra incidentes |
| **Operario** | App móvil | Recibe asignaciones y actualiza estado en campo |

El análisis automático corre en un microservicio Python con el modelo **RT-DETR-L**, entrenado con datos de campo de EMASEO EP.

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTES                                  │
│   📱 React Native / Expo          🖥  React + Vite (Supervisor)  │
└────────────────────────┬────────────────────────────────────────┘
                         │  HTTPS (Cloudflare Tunnel / Ngrok)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              API GATEWAY  :4000  (Express + http-proxy)         │
│   • Validación JWT          • Rate limiting (express-rate-limit) │
│   • trust proxy (tunnels)   • Routing a microservicios           │
└──┬──────────────┬──────────────┬───────────────┬───────────────┘
   │              │              │               │
   ▼              ▼              ▼               ▼
:3002          :3000          :5000           :8000
Auth         Users          Image           ML Service
Service      Service        Service         (FastAPI / Python)
   │              │              │
   └──────────────┴──────────────┘
                  │  SQL (pg)
                  ▼
      ┌───────────────────────┐
      │  PostgreSQL 16        │  :5432 (Docker)
      │  + PostGIS 3.4        │
      └───────────────────────┘

      ┌───────────────────────┐
      │  MinIO                │  :9000 API  :9001 Console (Docker)
      │  (S3-compatible)      │  Bucket: emaseo-incidents (público)
      └───────────────────────┘
```

### Comunicación entre servicios

- El **API Gateway** actúa como único punto de entrada; los clientes nunca llaman directamente a los microservicios.
- El **Image Service** llama al **ML Service** de forma interna (`http://localhost:8000/predict`) — esta llamada es invisible para el cliente.
- Todos los servicios Node.js usan el driver `pg` para conectarse a PostgreSQL.
- El almacenamiento de imágenes se accede mediante el **AWS SDK v3** (`@aws-sdk/client-s3`), apuntando a MinIO en desarrollo o a S3 real en producción.

---

## 3. Stack Tecnológico

| Capa | Tecnología | Versión |
|------|-----------|---------|
| API Gateway | Node.js / Express | 18+ |
| Auth Service | Node.js / Express + `bcryptjs` + `nodemailer` | 18+ |
| Users Service | Node.js / Express | 18+ |
| Image Service | Node.js / Express + AWS SDK v3 | 18+ |
| ML Service | Python / FastAPI + Ultralytics RT-DETR | 3.10+ |
| Base de datos | PostgreSQL 16 + PostGIS 3.4 | Docker |
| Almacenamiento | MinIO (dev) / AWS S3 (prod) | Docker |
| App móvil | React Native / Expo | SDK 54 |
| Panel web | React + Vite | — |
| Modelo IA | RT-DETR-L v2 (`rtdetr_l_best.pt`) — 1 clase, mAP@50=0.880 | Ultralytics |

---

## 4. Microservicios Backend

### API Gateway `:4000`

Punto de entrada único. Responsabilidades:

- **Proxy HTTP** a los microservicios upstream via `http-proxy-middleware`.
- **Validación JWT** en las rutas protegidas (el token se verifica antes de reenviar la petición).
- **Rate limiting**: 100 peticiones / 15 min por IP (global); 20 análisis / hora para el endpoint de imagen.
- **`app.set('trust proxy', 1)`** — necesario para que `express-rate-limit` lea la IP real cuando el servidor corre detrás de Cloudflare Tunnel o Ngrok.

### Auth Service `:3002`

Maneja identidad y sesiones.

| Endpoint | Descripción |
|----------|-------------|
| `POST /auth/login` | Devuelve `access_token` (15 min) + `refresh_token` (7 días, hash SHA-256 en DB) |
| `POST /auth/refresh` | Rota el refresh token |
| `POST /auth/logout` | Revoca el refresh token |
| `POST /auth/forgot-password` | Genera OTP de 6 dígitos (15 min de validez) y lo envía por email |
| `POST /auth/verify-reset-otp` | Valida el OTP |
| `POST /auth/reset-password` | Actualiza contraseña en transacción atómica y marca el OTP como usado |

El flujo de registro de ciudadanos es de **3 pasos**: datos → verificación OTP por email → establecer contraseña. Los registros pendientes viven en `public.pending_registrations` hasta completarse.

### Users Service `:3000`

CRUD de perfiles de usuario (ciudadanos, operarios, supervisores). Incluye gestión de avatar y datos de contacto.

### Image Service `:5000`

Orquestador del flujo de reporte. Pasos en orden:

```
1. Validación de imagen
   ├─ Magic bytes (JPEG: FF D8 / PNG: 89 50 4E 47)
   ├─ Dimensiones mínimas: 320 × 320 px
   └─ Tamaño mínimo: 1 KB

2. Upload a MinIO  →  incidents/{uuid}.jpg

3. POST http://localhost:8000/predict  (imagen en base64)

4. ¿has_waste === false?
   ├─ SÍ  → DeleteObject en MinIO + respuesta 422 "Rechazo Amigable"
   └─ NO  → continúa

5. Transacción PostgreSQL atómica
   ├─ INSERT incidents.incidents   (ubicación PostGIS, prioridad de la IA)
   ├─ INSERT incidents.incident_images  (URL pública MinIO)
   └─ INSERT ai.analysis_results   (tipo residuo, nivel, volumen, detecciones JSONB)

6. Respuesta 201 con metadata del incidente
```

**Rechazo Amigable**: si la IA no detecta basura, el Image Service elimina la imagen de MinIO (sin dejar huérfanos) y devuelve un mensaje legible al ciudadano antes de crear ningún registro en la base de datos.

---

## 5. Servicio ML — RT-DETR-L

**Archivo principal:** `Backend/ml-service/main.py`  
**Modelo:** `ML/modelos/rtdetr_l_best.pt` (v2 — entrenado en GPU Colab, best epoch 64/100)  
**Framework:** FastAPI + Ultralytics  
**Arquitectura:** RT-DETR-L, 32.8 M parámetros, 63 MB

### Métricas del modelo en producción (RT-DETR-L v2)

| Métrica | v1 (anterior) | v2 (actual) | Mejora |
|---------|--------------|-------------|--------|
| mAP@50 | 0.4752 | **0.8802** | +85.2% |
| mAP@50:95 | 0.2450 | **0.6069** | +147.7% |
| Precision | 0.5523 | **0.8840** | +60.1% |
| Recall | 0.4353 | **0.8203** | +88.5% |

> Best checkpoint (epoch 64/100) evaluado sobre conjunto de validación (623 imágenes).  
> Ver detalles completos en `ML/resultados/README.md`.

### Dataset de entrenamiento

**1 clase** (`garbage`) — 12.180 imágenes totales (11.557 train / 623 val)  
Fuente: Garbage Collector v8 — Roboflow

### Pipeline de inferencia

```
Imagen base64
     │
     ▼
Decodificación PIL
     │
     ▼
RTDETR.predict(conf=0.35, iou=0.50)  ← NMS interno
     │
     ▼
Filtro 1: Whitelist de clases
│  Acepta: RECICLABLE, ORGANICO, ESCOMBROS, PELIGROSO, MIXTO
│          (+ aliases: garbage, basura, organico, organic,
│           escombros, debris, peligroso, hazardous,
│           reciclable, recyclable, domestico, vidrio, glass)
│  Descarta: person, dog, car, etc. (clases COCO heredadas)
     │
     ▼
Filtro 2: bbox área < 0.5% del frame → descartado como ruido
     │
     ├── Sin detecciones válidas → has_waste: false  (Rechazo Amigable)
     │
     └── Con detecciones → cálculo de métricas
              │
              ├─ coverage_ratio = Σ(área bbox) / área imagen
              ├─ confianza media de detecciones
              └─ effective_ratio (heurística anti-falsos positivos)
                       │
                       ├─ conf_factor  = min(1.0, conf_media / 0.60)
                       ├─ det_factor   = min(1.0, 0.40 + 0.20 × num_detecciones)
                       └─ class_weight = multiplicador por peligrosidad del tipo

                       effective_ratio = coverage_ratio × conf_factor × det_factor × class_weight
```

### Heurística `effective_ratio`

El `effective_ratio` penaliza falsos positivos de volumen en tres pasos:

1. **Baja confianza** (`conf_factor`): si el modelo no está seguro, se reduce el coverage estimado.
2. **Pocas detecciones** (`det_factor`): 1 detección = ×0.60; 2 = ×0.80; 3+ = ×1.0.
3. **Corrección de escala** (`ISOLATION_PENALTY = ×0.65`): un único objeto con cobertura > 55% del frame probablemente fue fotografiado de cerca y no representa acumulación masiva.
4. **Peso por clase** (`class_weight`): PELIGROSO ×1.30; ESCOMBROS ×1.20; MIXTO ×1.00; ORGANICO ×0.95; DOMESTICO/VIDRIO ×0.90; RECICLABLE ×0.85.

El `coverage_ratio` original se devuelve en la respuesta sin modificar para trazabilidad.

### Bandas de clasificación

| `effective_ratio` | Nivel | Prioridad | Volumen estimado |
|-------------------|-------|-----------|-----------------|
| 0.00 – 0.15 | BAJO | BAJA | 0.1 – 0.5 m³ |
| 0.15 – 0.40 | MEDIO | MEDIA | 0.5 – 2.0 m³ |
| 0.40 – 0.70 | ALTO | ALTA | 2.0 – 5.0 m³ |
| 0.70 – 1.00 | CRITICO | CRITICA | 5.0 – 15.0 m³ |

### Mapeo de clases → `ai.waste_type`

| Clase del modelo | Aliases aceptados | ENUM PostgreSQL |
|-----------------|------------------|----------------|
| MIXTO | garbage, basura, mixto | MIXTO |
| RECICLABLE | reciclable, recyclable | RECICLABLE |
| ORGANICO | organico, organic | ORGANICO |
| ESCOMBROS | escombros, debris | ESCOMBROS |
| PELIGROSO | peligroso, hazardous | PELIGROSO |
| DOMESTICO | domestico, domestic | DOMESTICO |
| VIDRIO | vidrio, glass | VIDRIO |

---

## 6. Infraestructura Docker

El archivo `docker-compose.yml` levanta once servicios:

| Contenedor | Imagen / Build | Función | Puertos |
|-----------|---------------|---------|---------|
| `emaseo-postgres` | `postgis/postgis:16-3.4` | Base de datos + extensiones geoespaciales | 5432 |
| `emaseo-minio` | `minio/minio:latest` | Almacenamiento de imágenes (S3-compatible) | 9000, 9001 |
| `emaseo-minio-init` | `minio/mc:latest` | Crea el bucket y lo hace público (efímero) | — |
| `emaseo-redis` | `redis:7-alpine` | Broker + result backend de Celery | 6379 |
| `emaseo-auth` | Build `./Backend/auth-service` | Servicio de autenticación y sesiones | 3002 |
| `emaseo-users` | Build `./Backend/users-service` | CRUD de perfiles de usuario | 3000 |
| `emaseo-image` | Build `./Backend/image-service` | Orquestador de reportes + pipeline async | 5000 |
| `emaseo-gateway` | Build `./Backend/api-gateway` | API Gateway (único punto de entrada) | 4000 |
| `emaseo-ml-api` | Build `./Backend/ml-service` | API ML — Gunicorn + Uvicorn workers | 8000 |
| `ml-worker` (sin nombre fijo) | Build `./Backend/ml-service` | Worker Celery para inferencia GPU/CPU | — |
| `emaseo-flower` | `mher/flower:2.0` | Dashboard de tareas Celery | 5555 |

**Persistencia**: volúmenes Docker nombrados `postgres_data`, `minio_data`, `redis_data` y `shared_uploads` sobreviven reinicios. `shared_uploads` es el volumen compartido entre `ml-api` (escritura) y `ml-worker` (lectura + borrado).

**Bootstrap automático**: `minio-init` espera a que MinIO esté `healthy`, crea el bucket `emaseo-incidents` y lo marca como de descarga pública, luego termina.

**Inicialización de esquema**: PostgreSQL ejecuta automáticamente los scripts en `Backend/database/` al primer inicio (volumen `docker-entrypoint-initdb.d`).

**Escalado horizontal del worker**: `docker compose up -d --scale ml-worker=N` lanza N réplicas del worker Celery. Cada réplica recibe un hostname único y, en hosts multi-GPU, ocupa un slot de GPU independiente.

---

## 7. Frontend — Aplicación Móvil

**Stack:** React Native (Expo SDK 54) + TypeScript  
**Directorio:** `Frontend/smart-waste-mobile/`

### Navegación

```
Splash
  └─ Login ──────────────────────────── Home
       └─ Register                        ├─ Scan ──→ ScanResult
            └─ OtpVerification            ├─ Historial ──→ ReportDetail
                 └─ SetPassword           └─ Perfil
  └─ ForgotPassword
       └─ ForgotPasswordOtp
            └─ ResetPassword
```

### Flujo de cámara (`ScanScreen.tsx`)

El flujo está diseñado para evitar condiciones de carrera en la solicitud de permisos:

1. **Permisos secuenciales**: primero Cámara, luego GPS (nunca en paralelo).
2. **Fase de escaneo** (0 – 2.6 s): línea animada sobre el frame; esquinas pulsantes.
3. **Fase lista** (2.6 s+): badge verde "¡Área lista! Pulsa para capturar".
4. **Captura**: foto a calidad 0.82 + coordenadas GPS de alta precisión.
5. **Revisión**: preview con opción de "Analizar y Reportar" o "Retomar".
6. **Análisis**:
   - Timeout de 110 s (el cold-start del modelo puede tardar 30-90 s).
   - Barra de progreso de upload.
   - Botón de cancelar via `AbortController`.
7. **Resultado**: navega a `ScanResult` con metadata del incidente.

### Historial de reportes (`ReportDetail`)

Vista de solo lectura estilo "Recibo de Uber":

- Mapa interactivo (`react-native-maps`) con pin de la ubicación del incidente.
- Dirección de calle obtenida por **geocoding inverso** (coordenadas → texto legible).
- Resumen del análisis de la IA: nivel, volumen, tipo de residuo, confianza.
- Foto del incidente cargada desde la URL pública de MinIO.

---

## 8. Esquema de Base de Datos

**Motor:** PostgreSQL 16 + PostGIS 3.4  
**Scripts:** `Backend/database/`

### Schemas

| Schema | Contenido |
|--------|-----------|
| `auth` | `users`, `refresh_tokens`, `password_reset_tokens` |
| `public` | `ciudadanos` (perfil 1:1 con `auth.users`), `pending_registrations` |
| `operations` | `operarios`, `zones` (polígonos PostGIS EPSG:4326) |
| `incidents` | `incidents`, `incident_images`, `status_history`, `assignments` |
| `ai` | `analysis_results` (salida completa del modelo, `detecciones` JSONB) |
| `notifications` | Cola de notificaciones push/email |

### ENUMs clave

```sql
auth.user_role:            CIUDADANO | OPERARIO | SUPERVISOR | ADMIN
incidents.incident_status: PENDIENTE | EN_ATENCION | RESUELTA | RECHAZADA
incidents.priority_level:  BAJA | MEDIA | ALTA | CRITICA
ai.waste_type:             DOMESTICO | ORGANICO | RECICLABLE | ESCOMBROS | PELIGROSO | MIXTO | OTRO
ai.accumulation_level:     BAJO | MEDIO | ALTO | CRITICO
```

### Índices geoespaciales

```sql
-- Consultas de proximidad sobre incidentes
CREATE INDEX ON incidents.incidents USING GIST (ubicacion);

-- Asignación de zona por operario
CREATE INDEX ON operations.zones USING GIST (geom);

-- Búsqueda JSONB de detecciones
CREATE INDEX ON ai.analysis_results USING GIN (detecciones);
```

---

## 9. Flujos Principales

### Reporte de incidente (ciudadano)

El pipeline es **asíncrono**: la respuesta HTTP llega antes de que el ML procese la imagen; el cliente sondea el estado.

```
App móvil
  → POST /api/image/analyze  (base64 + lat/lon)
      → API Gateway valida JWT + rate limit
          → Image Service
              → valida parámetros + coordenadas Ecuador
              → INSERT incidents estado=PROCESANDO
              ← 202 { task_id, poll_url }     ← respuesta inmediata

              [background — setImmediate]
              → health check ML (3 s timeout)
              → Circuit Breaker → POST ml-api:8000/predict (imagen base64)
              ← has_waste: false
                  → UPDATE incidents estado=FALLIDO
              ← has_waste: true
                  → PutObject MinIO  →  incidents/{uuid}.jpg
                  → Transacción PostgreSQL atómica
                      UPDATE incidents estado=PENDIENTE prioridad=<IA>
                      INSERT incidents.incident_images  (URL pública MinIO)
                      INSERT ai.analysis_results        (JSONB detecciones)

  ← App sondea GET /api/image/status/:task_id
      → 202 PROCESANDO  (pipeline en curso)
      → 200 FALLIDO     (no se detectaron residuos o error)
      → 200 PENDIENTE   (éxito — incluye nivel, volumen, tipo_residuo, ...)
  ← App muestra resultado al ciudadano
```

### Autenticación

```
POST /api/auth/login
  → API Gateway → Auth Service
      → bcrypt.compare(password, hash)
      → genera access_token JWT (15 min)
      → genera refresh_token (64 bytes) → hash SHA-256 → INSERT auth.refresh_tokens
      ← {access_token, refresh_token}

POST /api/auth/refresh
  → API Gateway → Auth Service
      → SHA-256(token) → busca en DB → verifica no revocado y no expirado
      → rota: DELETE viejo + INSERT nuevo refresh_token
      ← {access_token, refresh_token}
```

### Registro de ciudadano (3 pasos)

```
1. POST /api/auth/register     → INSERT pending_registrations + envía OTP email
2. POST /api/auth/verify-otp   → valida OTP (15 min) → marca pendiente como verificado
3. POST /api/auth/set-password → transacción: INSERT auth.users + INSERT public.ciudadanos
                                 → elimina pending_registration
```
