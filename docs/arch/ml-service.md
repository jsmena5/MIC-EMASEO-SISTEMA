# ML Service — Arquitectura

## 1. Arquitectura del sistema

El ML Service es el microservicio de inteligencia artificial de MIC-EMASEO. Ejecuta el pipeline de inferencia sobre imágenes: detecta residuos con RT-DETR, filtra falsos positivos con CLIP, estima volumen con MiDaS y calcula la severidad del incidente. Se compone de dos procesos paralelos: una API FastAPI para pre-checks síncronos y un worker Celery para análisis asíncronos completos.

```
image-service :5000
  │
  ├── gRPC :50051 ────► ml-worker (Celery)
  │                         │
  │                         ├── RT-DETR-L  (ultralytics)
  │                         ├── CLIP RN50  (open-clip-torch)
  │                         └── MiDaS      (torch.hub, opcional)
  │
  └── HTTP :8000 ─────► ml-api (FastAPI + Gunicorn)
                            │
                            ├── /pre-check  (síncrono, <200ms)
                            └── /predict    (encola en Celery → task_id)

Ambos comparten:
  ├── Redis (broker + backend Celery)
  └── shared_uploads (volumen Docker)
```

**Ruta raíz:** `Backend/ml-service/`
**Puerto API:** 8000
**Puerto gRPC:** 50051
**Runtime:** Python 3.11
**Framework API:** FastAPI + Gunicorn + UvicornWorker
**Cola:** Celery + Redis

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **Worker queue** | Celery distribuye inferencias pesadas; evita bloquear la API |
| **Pipeline secuencial** | 6 etapas ordenadas; cada una puede cortar el flujo |
| **Gate pattern** | CLIP y garbage_score actúan como puertas de rechazo temprano |
| **Dual interface** | FastAPI para HTTP síncrono + gRPC para RPC interno eficiente |
| **Dummy mode** | En desarrollo retorna resultados fake sin cargar modelos |

---

## 3. Decisiones arquitectónicas

### 3.1 RT-DETR-L como detector (no YOLOv8)
RT-DETR-L es un transformer detector sin NMS nativo. Se eligió sobre YOLOv8 por menor tasa de falsos positivos en imágenes de basura urbana con fondo complejo.

**Modelo:** `rtdetr_l_best.pt` (32.8 M parámetros, 63 MB), entrenado con Ultralytics en Colab T4.

### 3.2 CLIP RN50 como gate semántico (no ViT-B/32)
Se cambió de ViT-B/32 a RN50 en la sesión 2026-06-20 por velocidad (~3s vs 80s de encode_image). El gate semántico clasifica la imagen en vectores de texto ("garbage in street", "clean street", "person", "interior") y rechaza las que no superan el umbral.

**Umbrales:**
```python
SEMANTIC_REJECT_THRESHOLD = 0.30  # rechaza como no-basura
SEMANTIC_REVIEW_THRESHOLD = 0.62  # envía a revisión humana
```

### 3.3 Pre-check separado del análisis completo
`/pre-check` ejecuta solo el garbage_score (OpenCV: ratio píxeles oscuros/sucios vs total), es síncrono y responde en <200ms. Si falla bloquea el envío desde la app móvil antes de desperdiciar un slot Celery.

**Por qué fail-closed:** Es preferible falso negativo (ciudadano reintenta) a falso positivo (incidente inválido en el sistema).

### 3.4 Celery prefork con `worker_process_init`
El fix del deadlock PyTorch/fork (sesión 2026-06-20): los modelos (CLIP, MiDaS, RT-DETR) se cargan en `worker_process_init` — se ejecuta en cada proceso hijo después del fork, no en el padre. Así PyTorch no hace fork con threads activos.

**Por qué:** PyTorch tiene threads internos (OpenMP, MKL). Si se carga en el proceso padre y luego Celery hace fork, los threads quedan en estado inconsistente causando deadlock en `futex_wait`. Cargar en el hijo evita esto.

### 3.5 Concurrencia Celery = 1, OMP_NUM_THREADS = 3
Un solo worker process con 3 threads de CPU para las operaciones matriciales de PyTorch. Evita contention entre múltiples workers compitiendo por los mismos núcleos en la VPS.

**Por qué no 2 workers:** Con concurrencia=2 el throughput no mejora porque ambos workers compiten por la misma CPU; la latencia aumenta. Con 1 worker y 3 threads se maximiza el uso del hardware disponible.

### 3.6 Bandas de severidad (no modelo de clasificación)
La severidad (BAJO/MEDIO/ALTO/CRITICO) se calcula por reglas explícitas sobre `coverage_union` (fracción de la imagen cubierta por detecciones) y `volume_estimated_m3` (interpolado). No hay un modelo de clasificación adicional.

**Por qué:** Interpretable y ajustable sin reentrenar. Los supervisores pueden calibrar las bandas sin ML expertise.

```python
_BANDS = [
  (cov_min, cov_max, vol_min, vol_max, nivel, prioridad)
  (0.00, 0.15,  0.05, 0.50, "BAJO",    "BAJA"),
  (0.15, 0.40,  0.50, 1.30, "MEDIO",   "MEDIA"),
  (0.40, 0.70,  1.30, 1.90, "ALTO",    "ALTA"),
  (0.70, 1.00,  1.90, 6.00, "CRITICO", "CRITICA"),
]
```

### 3.7 MiDaS como estimador de volumen (desactivado por default)
MiDaS estima profundidad monocular. Combinado con la cobertura de detecciones, estima el volumen en m³. `USE_MIDAS_VOLUME=false` en producción porque añade 1–2s por imagen y el estimador basado en cobertura es suficiente.

### 3.8 Dummy mode para desarrollo
`DUMMY_MODE=true` hace que el worker devuelva resultados hardcodeados sin cargar ningún modelo. Permite desarrollar los paneles y la app móvil sin una GPU disponible.

---

## 4. Comunicación interna y externa

### Desde image-service → ml-service

```
image-service
  │
  ├── gRPC (puerto 50051) ─► RunInference(image_key, task_id)
  │                              │
  │                              ▼
  │                          Celery.apply_async('run_inference', ...)
  │                              │
  │                              ▼
  │                          Worker Celery (mismo pod Docker)
  │
  └── HTTP (puerto 8000) ──► POST /pre-check { image_base64 }
                                  └──► garbage_score síncrono
```

### gRPC proto (`ml_service.proto`)
```protobuf
service MLService {
  rpc RunInference(InferenceRequest) returns (InferenceResponse);
  rpc GetTaskStatus(TaskStatusRequest) returns (TaskStatusResponse);
  rpc PreCheck(PreCheckRequest) returns (PreCheckResponse);
}
```

### Redis como broker y backend
- **Broker:** `redis://:<pw>@redis:6379/0` — recibe tareas Celery
- **Backend:** `redis://:<pw>@redis:6379/0` — almacena resultados para polling

### Callback hacia image-service
Cuando la tarea Celery termina, el worker actualiza la BD directamente (tiene su propia conexión PostgreSQL) o notifica vía el backend Redis para que el recovery worker del image-service lo detecte.

---

## 5. Funcionalidades

### 5.1 Pre-check síncrono
```
POST /pre-check
Body: { image_base64 }
Respuesta (< 200ms):
  {
    garbage_score: 0.72,          -- 0-1, ratio de píxeles "sucios"
    passes: true,                  -- supera el umbral PRE_CHECK_THRESHOLD
    guidance: {
      coverage: 0.42,
      distance_hint: "OPTIMAL"    -- TOO_CLOSE | OPTIMAL | TOO_FAR
    }
  }

Flujo:
1. Decodifica base64 → PIL Image
2. Convierte a HSV/LAB (OpenCV)
3. Calcula ratio de píxeles oscuros/sucios (garbage_score)
4. Si garbage_score < PRE_CHECK_THRESHOLD → passes=false
5. Calcula distance_hint con cobertura de imagen
```

### 5.2 Inferencia completa (asíncrona)
```
POST /predict
Body: { image_key: "s3://bucket/key", task_id }
Respuesta (inmediata, status 202):
  { task_id, status: "queued" }

Worker Celery ejecuta 6 etapas:
  Etapa 1a: Descarga imagen desde S3 (boto3)
  Etapa 1b: Garbage score gate (hard floor = 0.20)
  Etapa 2:  RT-DETR-L detect (conf=0.60, iou=0.50)
  Etapa 3:  Blur gate (Laplacian variance ≥ 80)
             Coverage gate (union ≥ 0.03)
  Etapa 4:  Clasificación de severidad (bandas)
             Peso por clase (PELIGROSO×1.30, etc.)
             pile_rescue (agrupación de detecciones dispersas)
  Etapa 5:  CLIP RN50 gate semántico
  Etapa 6:  MiDaS volumen (si USE_MIDAS_VOLUME=true)

Resultado:
  {
    tipo_residuo: "MIXTO",
    nivel_acumulacion: "MEDIO",
    prioridad: "MEDIA",
    confianza: 0.73,
    volumen_estimado_m3: 0.85,
    has_waste: true,
    decision: "INCIDENTE_VALIDO",  -- o REVISION_REQUERIDA/RECHAZO_CONFIABLE/ERROR_TECNICO
    detecciones: [
      { class: "garbage", confianza: 0.95, bbox: [...], area_ratio: 0.42 }
    ],
    garbage_score: 0.72,
    blur_score: 180,
    coverage_union: 0.42
  }
```

### 5.3 Polling de estado
```
GET /predict/status/:task_id
→ Consulta Celery backend (Redis)
→ { status: "PENDING|STARTED|SUCCESS|FAILURE", result? }
```

### 5.4 Healthcheck
```
GET /health
→ { status: "ok", broker: "connected", dummy_mode: false }
```

---

## 6. Otros aspectos importantes

### Clases de residuo
```python
WASTE_REGISTRY = (
  WasteClass("PELIGROSO",  weight=1.30),  # Jeringas, químicos
  WasteClass("ESCOMBROS",  weight=1.20),  # Materiales construcción
  WasteClass("MIXTO",      weight=1.00),  # Combinado
  WasteClass("DOMESTICO",  weight=0.90),  # Bolsas residenciales
  WasteClass("ORGANICO",   weight=0.95),  # Restos comida/jardín
  WasteClass("RECICLABLE", weight=0.85),  # Plástico/papel/metal
  WasteClass("VIDRIO",     weight=0.90),  # Envases vidrio
)
```

El `weight` amplifica o atenúa el `coverage_union` antes de calcular la banda, priorizando residuos peligrosos.

### Variables de entorno requeridas
```env
# ML
DUMMY_MODE=false
ML_MODEL_PATH=/app/models/rtdetr_l_best.pt
NMS_CONF=0.60
NMS_IOU=0.50
PRE_CHECK_THRESHOLD=0.35
GARBAGE_SCORE_HARD_FLOOR=0.20
BLUR_VARIANCE_MIN=80.0
MIN_COVERAGE_UNION=0.03
SEMANTIC_REJECT_THRESHOLD=0.30
SEMANTIC_REVIEW_THRESHOLD=0.62
USE_MIDAS_VOLUME=false

# Celery / Redis
REDIS_URL=redis://:<pw>@redis:6379/0
CELERY_CONCURRENCY=1
OMP_NUM_THREADS=3

# S3 / R2
S3_ENDPOINT=https://...
S3_BUCKET=emaseo-incidents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...

# gRPC
GRPC_PORT=50051
```

### Dependencias clave
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
gunicorn==22.0.0
celery[redis]>=5.3.6
ultralytics==8.3.0          # RT-DETR-L
torch==2.1.2+cpu
torchvision==0.16.2+cpu
open-clip-torch>=2.24.0     # CLIP RN50
timm>=0.9.0                 # backbones
grpcio>=1.64.0
grpcio-tools>=1.64.0
boto3>=1.34.0
pillow>=10.0.0
```

### Estructura de archivos
```
Backend/ml-service/
├── main.py                   # FastAPI app
├── celery_app.py             # Config Celery + worker_process_init
├── tasks.py                  # Tarea run_inference (pipeline completo)
├── ml_utils.py               # Funciones puras: bandas, volumen, geometría
├── semantic_gate.py          # Gate CLIP (carga modelo, evalúa prompts)
├── grpc_server.py            # Servidor gRPC paralelo
├── config_classes.py         # WASTE_REGISTRY, WasteClass
├── gunicorn.conf.py          # Workers=2, timeout=120
├── ml_service.proto          # Definición gRPC
└── scripts/
    ├── warmup_midas.py       # Pre-descarga MiDaS al build
    └── warmup_clip.py        # Pre-descarga CLIP al build
```

### Persistencia de pesos
Los pesos de los modelos se guardan en volúmenes Docker:
- `hf_cache:/root/.cache/huggingface` — CLIP RN50 (HuggingFace)
- `/app/models/` — RT-DETR-L `.pt` (copiado en Dockerfile)

Al arrancar, si los pesos no están en el volumen, se descargan automáticamente. El `warmup_*` en el Dockerfile los pre-descarga durante el build.

### Flower (monitoring Celery)
```
mher/flower:2.0 en puerto 5555
Usuario/contraseña configurables
Muestra: workers activos, tareas pendientes, historial, tiempos de ejecución
```
