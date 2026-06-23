# Image Service — Arquitectura

## 1. Arquitectura del sistema

El Image Service es el microservicio central de negocio de MIC-EMASEO. Orquesta el ciclo de vida completo de un reporte de basura: recibe la imagen del ciudadano, la sube a almacenamiento, encola la inferencia ML, gestiona el flujo de estados del incidente (PROCESANDO → PENDIENTE → EN_REVISION → EN_ATENCION → RESUELTA), coordina la asignación de operarios, y entrega notificaciones push.

```
api-gateway :4000
  │  /api/image/*, /api/incidents/*, /api/supervisor/*, /api/operario/*
  ▼
image-service :5000
  │
  ├── app.incidents         (PostgreSQL)
  ├── app.notifications     (PostgreSQL)
  ├── app.assignment_history(PostgreSQL)
  ├── Cloudflare R2 / MinIO (almacenamiento de imágenes)
  ├── ml-service :8000      (gRPC / HTTP — inferencia)
  └── Expo Push API         (notificaciones push)
```

**Ruta raíz:** `Backend/image-service/`
**Puerto:** 5000
**Runtime:** Node.js 22 + Express 5.2.1
**Límite de payload JSON:** 15 MB

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **Microservicio orquestador** | Coordina ml-service, S3, BD y notificaciones |
| **Async task + polling** | POST /analyze → task_id; GET /status/:id para resultado |
| **Circuit breaker** | Opossum protege las llamadas al ml-service |
| **Event-driven interno** | Recovery workers consultan periódicamente estado de tareas Celery |
| **Layered** | routes → controllers → services → db |

---

## 3. Decisiones arquitectónicas

### 3.1 Análisis asíncrono con Celery (no síncrono)
La inferencia ML (RT-DETR + CLIP + MiDaS) puede tardar 3–15 segundos. En lugar de mantener la conexión HTTP abierta, el gateway encola la tarea en Celery vía ml-service y responde de inmediato con un `task_id`. El cliente hace polling.

**Por qué:** Evita timeouts HTTP, permite reintentos sin reenviar la imagen, y desacopla la carga del ml-worker del throughput HTTP.

### 3.2 Pre-check ligero separado del análisis completo
`POST /api/image/validate-image` valida dimensiones/EXIF y `POST /api/ml/pre-check` ejecuta solo el garbage_score CLIP (sin Celery, <200ms). Ambos bloquean el envío si fallan.

**Por qué:** Filtra el 90% de fotos inválidas antes de desperdiciar un slot de Celery y capacidad de GPU.

### 3.3 Circuit breaker (Opossum)
Las llamadas al ml-service están envueltas en un circuit breaker (`mlCircuitBreaker.js`). Si el ml-service falla consecutivamente, el circuito se abre y las peticiones fallan rápido sin esperar timeout.

**Configuración:**
```javascript
timeout: 30000       // 30s para esperar respuesta
errorThresholdPercentage: 50  // abre tras 50% fallos
resetTimeout: 60000  // intenta cerrar tras 60s
```

### 3.4 Recovery automático de tareas Celery
Dos workers internos corren en el mismo proceso:
- `recoverStaleIncidents()` cada 5 min: busca incidentes `PROCESANDO` sin `celery_task_id` y los reencola.
- `recoverCeleryTasks()` cada 30s: consulta en Redis el estado de tareas Celery completadas y actualiza la BD.

**Por qué:** Si el image-service cae mientras hay tareas pendientes, al reiniciar recupera el estado sin perder reportes.

### 3.5 Almacenamiento dual: original + thumbnail
Al recibir la imagen, el service sube:
1. `original/` — imagen recortada sin modificar (para ML y auditoría)
2. `thumbnails/` — versión redimensionada (max 400px, webp) con `sharp` para cargas rápidas en paneles

### 3.6 Geocerca de cierre (operario)
Al marcar `PUT /asignaciones/:id/completar`, el servicio verifica que las coordenadas GPS del operario estén dentro de la tolerancia configurada en `app.operations.config` (clave `geocerca_tolerance_m`, default 10m). Usa `ST_DWithin` de PostGIS.

**Por qué:** Previene que el operario marque completada una tarea sin acudir físicamente al sitio.

### 3.7 Idempotencia de reportes (migración 046)
Cada reporte lleva un `idempotency_key` generado en el cliente. Un advisory lock de PostgreSQL impide que dos peticiones simultáneas del mismo ciudadano creen incidentes duplicados.

---

## 4. Comunicación interna y externa

### Hacia el cliente (via gateway)
- **Protocolo:** HTTP/JSON
- **Auth:** JWT validado en el gateway; llega `X-User-Id` y `X-User-Rol`

### Hacia ml-service
- **Protocolo primario:** gRPC (puerto 50051) para inferencia en caliente
- **Fallback:** HTTP REST si gRPC no disponible
- **Protección:** Circuit breaker Opossum

### Hacia S3/R2
- **SDK:** `@aws-sdk/client-s3` v3
- **Operaciones:** `PutObjectCommand` (upload), `GetObjectCommand` (proxy de medias)
- **Bucket:** `emaseo-incidents`

### Hacia Expo Push API
- **SDK:** `expo-server-sdk`
- **Modo:** polling worker que busca notificaciones pendientes en BD, las envía con retry y backoff exponencial

### Diagrama de flujo de análisis
```
Cliente
  │  POST /api/image/analyze  { image_base64, lat, lon }
  ▼
image-service
  │  1. Valida imagen (dimensiones, EXIF)
  │  2. Sube a R2 (original + thumbnail)
  │  3. Crea incidente estado=PROCESANDO en BD
  │  4. Llama ml-service.predict(image_key) via gRPC
  │  5. Devuelve { task_id, status: "queued" } al cliente
  │
  │  [asíncrono — Celery en Python]
  │  6. ML procesa imagen
  │  7. Callback HTTP → /api/image/callback/:task_id
  │  8. Actualiza incidente (estado, resultado, nivel, prioridad)
  │  9. Si INCIDENTE_VALIDO → estado=PENDIENTE
  │ 10. Notifica al ciudadano (push)
  │
Cliente
  │  GET /api/image/status/:taskId  (polling cada 1s)
  ▼  { status: "completed", result: { nivel, prioridad, ... } }
```

---

## 5. Funcionalidades

### 5.1 Validación de imagen
```
POST /api/image/validate-image
Body: { image_base64 }
→ Verifica: dimensiones mínimas, tamaño máximo, no corrupción EXIF
→ { valid: bool, errors: string[] }
```

### 5.2 Análisis completo
```
POST /api/image/analyze
Header: Authorization: Bearer <JWT> (ciudadano)
Body: { image_base64, latitude, longitude, idempotency_key }
→ Idempotency check (advisory lock PostgreSQL)
→ Upload S3 (original + thumbnail)
→ INSERT incidents estado=PROCESANDO
→ Encola en Celery via gRPC
→ { task_id, incident_id, status: "queued" }
```

### 5.3 Polling de estado
```
GET /api/image/status/:taskId
→ Consulta Redis (Celery) y/o BD
→ { status: "pending|processing|completed|failed", result? }
```

### 5.4 Historial del ciudadano
```
GET /api/incidents/me                → Lista paginada (filtrada por ciudadano_id)
GET /api/incidents/me/:id            → Detalle + timeline estados
```

### 5.5 Notificaciones del ciudadano
```
GET /api/incidents/notifications     → Lista de notificaciones (leídas y no)
PUT /api/incidents/notifications/read-all
PUT /api/incidents/notifications/:id/read
```

### 5.6 Panel supervisor — incidentes
```
GET  /api/supervisor/incidents           → Lista filtrable (estado, prioridad, zona, tipo)
GET  /api/supervisor/incidents/:id       → Detalle completo + historial
PUT  /api/supervisor/incidents/:id/estado    → Cambio de estado manual
POST /api/supervisor/incidents/:id/asignar  → Asignar operario
PUT  /api/supervisor/incidents/:id/revision-ia → { ia_fue_correcta, nivel_supervisor, tipo_supervisor }
```

### 5.7 Panel supervisor — zona
```
GET /api/supervisor/zonas/mapa         → GeoJSON con estadísticas por zona
GET /api/supervisor/mi-zona            → Zona del supervisor autenticado
GET /api/supervisor/zonas/estadisticas → KPIs agregados
GET /api/supervisor/operarios          → Operarios de la zona del supervisor
```

### 5.8 Panel operario
```
GET /api/operario/asignaciones           → Asignaciones activas en su zona
GET /api/operario/asignaciones/:id
PUT /api/operario/asignaciones/:id/completar    → GPS requerido, valida geocerca
PUT /api/operario/asignaciones/:id/no-atendible → Rechaza con motivo
POST /api/operario/feedback/:incident_id        → Feedback calidad IA
GET  /api/operario/feedback/:incident_id
```

### 5.9 Panel admin — IA y auditoría
```
GET /api/supervisor/ia/estadisticas → Precisión IA por clase
GET /api/supervisor/ia/dataset      → JSON exportable para reentrenamiento
GET /api/supervisor/ia/imagenes     → Grid paginado de imágenes R2
PUT /api/supervisor/ia/imagenes/:id/etiqueta → VÁLIDA | DUDOSA | EXCLUIR
```

### 5.10 Healthcheck
```
GET /health → 200 { status: "ok" }
```

---

## 6. Otros aspectos importantes

### Tabla `incidents` (simplificada)
```sql
app.incidents
  id                    UUID PRIMARY KEY
  ciudadano_id          INT FK
  image_url             VARCHAR        -- URL pública R2
  image_url_thumbnail   VARCHAR
  latitud, longitud     NUMERIC
  ubicacion_aproximada  VARCHAR        -- geocoding inverso
  estado                ENUM('PROCESANDO','PENDIENTE','EN_REVISION',
                             'EN_ATENCION','RESUELTA','RECHAZADA',
                             'DESCARTADO','FALLIDO')
  tipo_residuo          VARCHAR
  nivel_acumulacion     ENUM('BAJO','MEDIO','ALTO','CRITICO')
  prioridad             ENUM('BAJA','MEDIA','ALTA','CRITICA')
  confianza             NUMERIC(4,3)
  volumen_estimado_m3   NUMERIC
  detecciones           JSONB
  has_waste             BOOLEAN
  decision              ENUM('INCIDENTE_VALIDO','REVISION_REQUERIDA',
                             'RECHAZO_CONFIABLE','ERROR_TECNICO')
  supervisor_id         INT FK
  ia_fue_correcta       BOOLEAN
  nivel_acumulacion_supervisor ENUM
  tipo_residuo_supervisor      VARCHAR
  operario_id           INT FK
  celery_task_id        VARCHAR        -- referencia Redis
  idempotency_key       VARCHAR UNIQUE
  error_message         VARCHAR
  created_at, updated_at, completado_en TIMESTAMP
```

### Variables de entorno requeridas
```env
PORT=5000
INTERNAL_TOKEN=...
DB_USER=image_svc
DB_HOST=postgres
DB_NAME=MIC-EMASEO
DB_PASSWORD=...
DB_PORT=5432
ML_SERVICE_URL=http://ml-api:8000
ML_GRPC_HOST=ml-worker
ML_GRPC_PORT=50051
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_BUCKET=emaseo-incidents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
S3_PUBLIC_URL=https://r2.emaseo.ec
MINIO_INTERNAL_URL=http://minio:9000
GEOCERCA_TOLERANCE_M=10
```

### Dependencias clave
```
@aws-sdk/client-s3: ^3.1032.0
@grpc/grpc-js: ^1.11.0
@grpc/proto-loader: ^0.7.13
opossum: ^9.0.0    -- circuit breaker
sharp: ^0.34.0     -- thumbnails
pg: ^8.20.0
uuid: ^13.0.0
expo-server-sdk    -- push notifications
```

### Estructura de archivos
```
Backend/image-service/src/
├── index.js
├── db.js
├── mlCircuitBreaker.js
├── controllers/
│   ├── image.controller.js       # analyze, status, validate-image
│   ├── incident.controller.js    # historial ciudadano, notificaciones
│   ├── supervisor.controller.js  # panel supervisor
│   ├── operario.controller.js    # asignaciones operario
│   ├── ia.controller.js          # estadísticas IA, dataset
│   └── feedback.controller.js    # feedback ciudadano
├── routes/
│   ├── image.routes.js
│   ├── incident.routes.js
│   ├── supervisor.routes.js
│   └── operario.routes.js
├── services/
│   └── image.service.js          # lógica de upload, inferencia, BD
├── workers/
│   └── notificationWorker.js     # polling push con retry+backoff
├── middleware/
│   ├── internalAuth.middleware.js
│   └── requestId.middleware.js
└── utils/
    ├── imageValidation.js
    └── logger.js
```

### Estados del incidente y transiciones válidas
```
PROCESANDO ──┬──► PENDIENTE          (ML: INCIDENTE_VALIDO)
             ├──► REVISION_REQUERIDA (ML: confianza baja)
             ├──► RECHAZADA          (ML: RECHAZO_CONFIABLE)
             └──► FALLIDO            (error técnico)

PENDIENTE ──────► EN_REVISION        (supervisor inicia revisión)
EN_REVISION ────► EN_ATENCION        (supervisor asigna operario)
EN_ATENCION ────► RESUELTA           (operario completa, geocerca OK)
EN_ATENCION ────► DESCARTADO         (operario marca no-atendible)
```
