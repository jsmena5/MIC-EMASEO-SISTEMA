# Documentación Técnica — Sistema EMASEO EP

**Proyecto:** Sistema de detección y gestión de acumulaciones de basura  
**Entidad:** EMASEO EP (Empresa Pública Metropolitana de Aseo de Quito)  
**Repositorio:** https://github.com/jsmena5/MIC-EMASEO-SISTEMA  
**Última actualización:** Junio 2026

---

## Tabla de Contenidos

1. [Visión General](#1-visión-general)
2. [Arquitectura del Sistema](#2-arquitectura-del-sistema)
3. [Despliegues y URLs](#3-despliegues-y-urls)
4. [APK Móvil](#4-apk-móvil)
5. [Pipeline de Análisis de Imagen (ML)](#5-pipeline-de-análisis-de-imagen-ml)
6. [Base de Datos](#6-base-de-datos)
7. [API — Rutas Principales](#7-api--rutas-principales)
8. [Ciclo de Vida de un Incidente](#8-ciclo-de-vida-de-un-incidente)
9. [Seguridad y Cumplimiento](#9-seguridad-y-cumplimiento)
10. [Infraestructura y DevOps](#10-infraestructura-y-devops)
11. [Variables de Entorno Críticas](#11-variables-de-entorno-críticas)
12. [Glosario](#12-glosario)

---

## 1. Visión General

El sistema permite a ciudadanos de Quito reportar acumulaciones de basura desde una app móvil. La imagen pasa por un pipeline de inteligencia artificial de múltiples capas que determina si hay residuos reales, su nivel de acumulación y la prioridad de atención. Los supervisores de EMASEO revisan los casos dudosos desde un panel web, y los operarios de campo reciben las asignaciones para atenderlos.

### Componentes principales

| Componente | Tecnología | Descripción |
|---|---|---|
| App ciudadano | React Native (Expo) | Reportar, ver historial, recibir notificaciones |
| Panel supervisor | React + Vite | Revisar, validar, asignar incidentes |
| Panel administrador | React + Vite | Dashboard, estadísticas, auditoría de imágenes |
| API Gateway | Node.js / Express | Punto único de entrada, proxy, autenticación, rate-limiting |
| Auth Service | Node.js / Express | JWT, refresh tokens, OTP, recuperación de contraseña |
| Users Service | Node.js / Express | Gestión de usuarios (ciudadanos, supervisores, operarios, admins) |
| Image Service | Node.js / Express | Orquestación del pipeline, historial de incidentes, notificaciones |
| ML Service (API) | FastAPI + Gunicorn | Endpoint síncrono pre-check; despacho a Celery |
| ML Service (Worker) | Celery + Redis | Inferencia asíncrona: RT-DETR-L + CLIP + MiDaS |
| Base de datos | PostgreSQL 18 + PostGIS | Supabase (cloud managed) |
| Almacenamiento S3 | Cloudflare R2 | Imágenes de incidentes (bucket: `emaseo-incidents`) |
| Reverse proxy | Caddy | TLS automático con Let's Encrypt, dominio DuckDNS |

---

## 2. Arquitectura del Sistema

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Caddy (TLS Let's Encrypt)                              │
│  micemaseo.duckdns.org → 127.0.0.1:4000                 │
└───────────────────────────┬─────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  API Gateway   │  :4000 (solo local)
                    │  Node.js       │  JWT · Proxy · CORS · Rate-limit
                    └───┬───┬───┬───┘
           ┌────────────┘   │   └─────────────────┐
           ▼                ▼                     ▼
    ┌──────────┐    ┌──────────────┐    ┌──────────────────┐
    │   Auth   │    │    Users     │    │  Image Service   │
    │  :3002   │    │   :3000      │    │     :5000        │
    └──────────┘    └──────────────┘    └────────┬─────────┘
                                                 │
                                    ┌────────────▼─────────────┐
                                    │       ML Service         │
                                    │  FastAPI :8000           │
                                    │  + Celery Worker         │
                                    │  + Redis :6379 (broker)  │
                                    └──────────────────────────┘

Almacenamiento externo:
  PostgreSQL (Supabase cloud) ←── todos los microservicios
  Cloudflare R2               ←── Image Service (imágenes)
```

### Puertos internos (red Docker)

| Servicio | Contenedor | Puerto | Imagen GHCR |
|---|---|---|---|
| API Gateway | emaseo-gateway | 127.0.0.1:**4000** | ghcr.io/jsmena5/mic-emaseo-sistema/api-gateway |
| Auth Service | emaseo-auth | **3002** | ghcr.io/jsmena5/mic-emaseo-sistema/auth-service |
| Users Service | emaseo-users | **3000** | ghcr.io/jsmena5/mic-emaseo-sistema/users-service |
| Image Service | emaseo-image | **5000** | ghcr.io/jsmena5/mic-emaseo-sistema/image-service |
| ML API (FastAPI) | emaseo-ml-api | **8000** | ghcr.io/jsmena5/mic-emaseo-sistema/ml-service |
| ML Worker (Celery) | — | — | misma imagen que ML API |
| Redis | emaseo-redis | **6379** | redis:7-alpine |
| Flower (monitor) | emaseo-flower | **5555** | mher/flower:2.0 |

> El único puerto expuesto al host es el **4000** del API Gateway, al que Caddy hace proxy.

---

## 3. Despliegues y URLs

### Backend (VPS Contabo)

| Recurso | Valor |
|---|---|
| Proveedor VPS | Contabo |
| Ruta en servidor | `/opt/mic-emaseo` |
| Comando de inicio | `docker compose -f docker-compose.prod.yml up -d` |
| URL pública API | **https://micemaseo.duckdns.org/api** |
| Dominio | `micemaseo.duckdns.org` (DuckDNS — IP dinámica) |
| TLS | Let's Encrypt (Caddy gestiona renovación automática) |
| Health check API | `GET https://micemaseo.duckdns.org/health` |

### Paneles Web (Cloudflare Pages)

| Panel | URL producción | Proyecto Cloudflare |
|---|---|---|
| **Supervisor** | https://mic-emaseo-panel.pages.dev | `mic-emaseo-panel` |
| **Administrador** | https://mic-emaseo-admin.pages.dev | `mic-emaseo-admin` |

> Los paneles se despliegan manualmente con Wrangler:  
> `npx wrangler pages deploy dist --project-name <nombre>`

### Base de Datos (Supabase)

| Recurso | Valor |
|---|---|
| Proveedor | Supabase (Free tier → plan escalable) |
| Host | `racsklqvunereluevwfp.supabase.co` |
| Puerto externo | 5432 (conexión directa) o 6543 (pgBouncer) |
| Motor | PostgreSQL 18 + PostGIS |
| Región | us-east-1 |
| Dashboard | https://supabase.com/dashboard/project/racsklqvunereluevwfp |

### Almacenamiento de Imágenes (Cloudflare R2)

| Recurso | Valor |
|---|---|
| Proveedor | Cloudflare R2 (compatible S3) |
| Bucket | `emaseo-incidents` |
| URL pública | Configurada en `S3_PUBLIC_URL` (variable de entorno) |
| Patrón de clave | `incidents/{uuid}.jpg` |
| Proxy interno | `GET /api/media/{bucket}/{key}` (vía API Gateway) |

> Las imágenes se sirven **siempre** a través del proxy `/api/media/` del gateway para evitar exponer las credenciales R2 y centralizar el control de acceso.

### Repositorio y CI/CD

| Recurso | Valor |
|---|---|
| GitHub | https://github.com/jsmena5/MIC-EMASEO-SISTEMA |
| Rama principal | `main` |
| CI/CD | GitHub Actions (`.github/workflows/ci.yml`) |
| Registry Docker | GHCR (GitHub Container Registry) |
| Build trigger | Push a `main` → build + push de imágenes Docker |

---

## 4. APK Móvil

### Descarga directa (canal preview — último build)

| Plataforma | URL de descarga |
|---|---|
| **Android (APK)** | https://expo.dev/artifacts/eas/aYi21mysRrWCotkogndt2L.apk |

> Este APK es del canal **preview** (uso interno / pruebas). Conecta directamente a `https://micemaseo.duckdns.org/api`.

### Builds y actualizaciones OTA

| Canal | Tipo | Descripción |
|---|---|---|
| `development` | APK (debug) | Para desarrollo local; requiere Expo Dev Client |
| `preview` | APK (release) | Pruebas internas; recibe actualizaciones OTA automáticas |
| `production` | App Bundle | Google Play Store / App Store |

**EAS Project ID:** `c259a64b-d63f-4a3d-bc7f-a9afcded7a48`  
**Cuenta Expo:** `bryanandreso`  
**Dashboard builds:** https://expo.dev/accounts/bryanandreso/projects/smart-waste-mobile/builds

### Actualizaciones OTA (Over-The-Air)

El APK del canal `preview` descarga automáticamente nuevas versiones al abrir la app, sin necesidad de reinstalar. Se publican con:

```bash
# Solo JS/assets — NO requiere recompilación nativa
cd Frontend/smart-waste-mobile
CI=1 npx eas-cli update --channel preview --platform android --message "descripción"
CI=1 npx eas-cli update --channel preview --platform ios    --message "descripción"
```

> Un nuevo build nativo (`eas build`) solo es necesario cuando se agregan/cambian dependencias nativas (permisos, módulos de cámara, etc.).

---

## 5. Pipeline de Análisis de Imagen (ML)

El sistema usa **tres modelos** en secuencia para analizar cada imagen reportada. El objetivo es minimizar los falsos positivos (ciudadanos que reportan cosas que no son basura) y los falsos negativos (basura real que pasa desapercibida).

### Modelos utilizados

| Modelo | Propósito | Peso en disco | Tiempo de carga (frío) |
|---|---|---|---|
| **RT-DETR-L** | Detección de residuos (bounding boxes) | `rtdetr_l_best.pt` en VPS | ~15-30 s |
| **CLIP ViT-B/32** | Gate semántico: ¿es basura o es otra cosa? | ~350 MB (LAION-2B) | ~10 s |
| **MiDaS_small** | Estimación de volumen 3D (profundidad) | ~15 MB | Lazy-load |

### Paso 0 — PRE-CHECK (síncrono, <200 ms)

Ocurre **en el cliente móvil** antes de subir la imagen completa. Envía un thumbnail de ~15 KB (320×240 px) al endpoint `POST /api/ml/pre-check`.

```
Thumbnail → compute_garbage_score() → score ∈ [0.0, 1.0]
  │
  ├─ score ≥ 0.35 → "parece basura" → app procede a reportar
  └─ score < 0.35 → "no parece basura" → app muestra advertencia al usuario
```

**Cómo funciona `garbage_score`:**

| Componente | Peso | Qué mide |
|---|---|---|
| Entropía de color | 45 % | Variedad de colores (basura = alta variedad) |
| Densidad de bordes | 40 % | Irregularidad de textura (basura = bordes dispersos) |
| Posición vertical | 15 % | Qué tan abajo está el objeto en el frame |

> Umbral: `PRE_CHECK_THRESHOLD = 0.35` (configurable)

---

### Paso 1 — RT-DETR-L: Detección de Residuos

El modelo principal. Recibe la imagen a resolución completa y devuelve bounding boxes con clase y confianza.

**Filtros aplicados post-detección:**

| Filtro | Valor | Descripción |
|---|---|---|
| `NMS_CONF` | **0.60** | Confianza mínima de detección (cajas con conf < 0.60 se descartan) |
| `NMS_IOU` | **0.50** | IoU máximo para supresión de cajas solapadas |
| `MIN_BBOX_AREA_RATIO` | **0.010** | Cajas que ocupen < 1 % del frame se descartan (objeto demasiado pequeño) |

**Si no hay detecciones:** el pipeline continúa con `has_waste = false` y pasa al gate CLIP.

---

### Paso 2 — Quality Gates (Calidad de imagen y geometría)

Se ejecutan sobre las detecciones del paso anterior.

#### Gate A — Nitidez (Blur)

```
Varianza del Laplaciano de la imagen < BLUR_VARIANCE_MIN (80.0)
  → imagen borrosa → resultado: EN_REVISION (el supervisor decide)
```

> Referencia: imagen nítida ~800-2000, imagen movida ~200-400, borrosa < 100.

#### Gate B — Cobertura mínima

```
Unión de todas las bboxes < MIN_COVERAGE_UNION (3 % del frame)
  → basura demasiado lejana o pequeña → resultado: EN_REVISION
```

> 3 % ≈ un objeto de 90×90 px en una imagen 640p.

---

### Paso 3 — Garbage Score (Análisis de textura)

Reusa el mismo scoring del pre-check, pero aplicado a la región de las bboxes.

| Umbral | Valor | Acción |
|---|---|---|
| `GARBAGE_SCORE_HARD_FLOOR` | **0.20** | Si score < 0.20 → descarte automático (sin revisión) |
| `GARBAGE_SCORE_THRESHOLD` | **0.50** | Si score < 0.50 → penalización en la confianza final |

**Penalizaciones por tipo de encuadre:**

| Caso | Condición | Multiplicador de confianza |
|---|---|---|
| Close-up (full frame) | Cobertura > 85 % del frame | × 0.20 |
| Objeto aislado | Cobertura 55-85 %, solo 1 detección | × 0.40 |
| Cluster de basura | Múltiples detecciones dispersas | Sin penalización |

---

### Paso 4 — CLIP ViT-B/32: Gate Semántico

Este es el filtro anti-falsos-positivos más importante. Responde la pregunta: **"¿Esta imagen muestra realmente basura, o es otra cosa (una persona, una habitación, una pantalla, un auto, etc.)?"**

Compara la imagen contra dos conjuntos de prompts de texto:

**10 prompts positivos (basura):**
- "pile of garbage on the street", "trash and waste dumped", "accumulated garbage bags", "overflowing garbage container", "debris and rubble pile", "scattered litter on the ground", "organic waste dumped", "mixed trash pile", "construction debris", "hazardous waste dumped"

**18 prompts negativos (no es basura):**
- "a person walking", "a person standing", "a person from behind", "a person with a backpack or bag", "indoor room", "furniture", "clean street", "wall or fence", "car or vehicle", "pet or animal", "garden or plants", "selfie or portrait", "screen or monitor", "building facade", "clothing or fabric", "a person in outdoor clothing", "people in a group", "a person sitting"

**Resultado: `garbage_prob` ∈ [0.0, 1.0]**

```
garbage_prob < 0.30  → claramente NO es basura → DESCARTADO (automático)
0.30 ≤ prob < 0.62   → ambiguo → EN_REVISION (supervisor decide)
prob ≥ 0.62          → muy probable basura → PENDIENTE (acepta el reporte)
```

| Threshold | Valor | Descripción |
|---|---|---|
| `SEMANTIC_REJECT_THRESHOLD` | **0.30** | Por debajo → descarte automático |
| `SEMANTIC_REVIEW_THRESHOLD` | **0.62** | Por debajo (pero sobre 0.30) → revisión humana |

> **Fail-open:** si CLIP falla por error técnico, el resultado es `needs_review = true` → EN_REVISION. Nunca descarta automáticamente si hay incertidumbre del modelo.

---

### Paso 5 — MiDaS: Estimación de Volumen (opcional)

Calcula un volumen estimado en m³ usando profundidad monocular.

| Parámetro | Valor | Descripción |
|---|---|---|
| `FOV_H_DEG` | 67° | Campo de visión horizontal (smartphone típico) |
| `FOV_V_DEG` | 51° | Campo de visión vertical |
| `GROUND_DEPTH_M` | 3.5 m | Distancia asumida al suelo visible |
| `DEPTH_PILE_RATIO` | 0.28 | Altura del montón ≈ 28 % del lado menor del bbox |
| `MAX_VOLUME_M3` | 20.0 m³ | Tope absoluto |

Si MiDaS no está activo, el volumen se estima por interpolación según la banda de severidad.

---

### Paso 6 — Banda de Severidad Final

Combina cobertura + volumen + número de detecciones para asignar el nivel:

| Nivel | Cobertura del frame | Volumen estimado | Validación extra |
|---|---|---|---|
| **BAJO** | < 15 % | 0.1 – 0.5 m³ | — |
| **MEDIO** | 15 – 40 % | 0.5 – 2.0 m³ | — |
| **ALTO** | 40 – 70 % | 2.0 – 5.0 m³ | — |
| **CRITICO** | 70 – 100 % | 5.0 – 15.0 m³ | Requiere ≥ 3 detecciones dispersas |

> Si el volumen MiDaS supera el techo de la banda × 1.10, el caso pasa a EN_REVISION por inconsistencia.

---

### Factor de Confianza Final

La confianza que se guarda en la BD y se muestra al supervisor es una combinación de:

```
confianza_final = conf_factor × det_factor × [penalizaciones]

conf_factor = conf / 0.60   si conf < 0.60
            = 1.0           si conf ≥ 0.60

det_factor  = 1 - e^(-0.50 × n_detecciones)  (logarítmico, tope 0.90)
              n=1 → 0.39,  n=3 → 0.78,  n=5 → 0.92
```

---

### Resumen del flujo completo

```
Ciudadano toma foto
       │
       ▼
[PRE-CHECK]  garbage_score < 0.35 → advertencia en app (no bloquea)
       │
       ▼  (si el ciudadano confirma → sube imagen)
[RT-DETR-L]  Detección de bboxes con NMS_CONF=0.60
       │
       ├─ Sin detecciones → has_waste=false
       │
       ▼
[QUALITY GATES]
  ├─ Blur < 80 → EN_REVISION
  └─ Cobertura < 3 % → EN_REVISION
       │
       ▼
[GARBAGE SCORE]
  └─ score < 0.20 → DESCARTADO automático
       │
       ▼
[CLIP ViT-B/32]
  ├─ prob < 0.30 → DESCARTADO (claramente no es basura)
  ├─ 0.30 ≤ prob < 0.62 → EN_REVISION
  └─ prob ≥ 0.62 → PENDIENTE (acepta)
       │
       ▼
[MiDaS + BANDA]  Calcula nivel y volumen
       │
       ▼
Estado final: PENDIENTE | EN_REVISION | DESCARTADO | FALLIDO
```

---

## 6. Base de Datos

### Esquemas PostgreSQL

| Esquema | Descripción |
|---|---|
| `incidents` | Incidentes, imágenes, historial de estados, asignaciones, zonas |
| `auth` | Usuarios autenticables, refresh tokens, reset tokens, device tokens |
| `app_auth` | Vista usada por el trigger SISTEMA para crear usuarios desde app_auth.users |
| `ai` | Resultados ML, feedback supervisado, auditoría de imágenes |
| `operations` | Operarios, configuración del sistema (geofence, umbrales) |
| `notifications` | Cola de notificaciones push y en-app |
| `audit` | Registro de acciones (LOPDP Art. 39) |

### Migraciones (42 archivos)

Las migraciones están en `Backend/database/` y se aplican manualmente en Supabase SQL Editor o pgAdmin. Son todas idempotentes (`IF NOT EXISTS`, `IF EXISTS`).

| Rango | Tema |
|---|---|
| 01–012 | Schema inicial, datos base, índices, aislamiento de usuarios DB |
| 013–023 | Notificaciones push, registro, consentimientos LOPDP |
| 024–027 | Cifrado PII (cédula/teléfono), Row-Level Security, retención |
| 028–031 | Soporte Celery (task recovery), índices, feedback IA |
| 032–033 | Flujo de revisión humana, correcciones supervisoras |
| 034–035 | Fix URLs imágenes (proxy gateway, R2 bucket duplicado) |
| 036–040 | Permisos, config admin, geocerca cierre, auditoría imágenes |
| 041–042 | Motivo estructurado de rechazo, índice LATERAL JOIN |

### Estados del ciclo de vida de un incidente

```
PROCESANDO ──[ML válido]──────────────────────────────► PENDIENTE
PROCESANDO ──[ML ambiguo / blur / cobertura]──────────► EN_REVISION
PROCESANDO ──[ML descarta con confianza ≥ 0.70]───────► DESCARTADO
PROCESANDO ──[error técnico]──────────────────────────► FALLIDO

EN_REVISION ──[supervisor valida]─────────────────────► PENDIENTE
EN_REVISION ──[supervisor rechaza]────────────────────► RECHAZADA
DESCARTADO  ──[supervisor anula]──────────────────────► PENDIENTE

PENDIENTE   ──[asignado a operario]───────────────────► EN_ATENCION
PENDIENTE   ──[supervisor rechaza]────────────────────► RECHAZADA
EN_ATENCION ──[operario cierra in-situ con GPS]───────► RESUELTA
EN_ATENCION ──[supervisor rechaza]────────────────────► RECHAZADA
EN_ATENCION ──[devuelve a cola]───────────────────────► PENDIENTE

RESUELTA, RECHAZADA, FALLIDO → (terminales, no más transiciones)
```

### Motivos estructurados de rechazo

Cuando el supervisor rechaza un incidente, debe seleccionar un motivo:

| Código | Etiqueta (supervisor) | Etiqueta (ciudadano) |
|---|---|---|
| `NO_ES_BASURA` | No es basura (falso positivo) | No se detectó basura en la imagen |
| `MUY_LEJOS_PEQUENO` | Muy lejos o muy pequeño | La acumulación estaba muy lejos o era muy pequeña |
| `IMAGEN_BORROSA` | Imagen borrosa o de baja calidad | La imagen estaba borrosa o de baja calidad |
| `DUPLICADO` | Reporte duplicado | Este reporte ya fue registrado anteriormente |
| `OTRO` | Otro (especificar en observaciones) | Motivo indicado por el supervisor |

---

## 7. API — Rutas Principales

Base URL: `https://micemaseo.duckdns.org/api`

### Rutas públicas (sin autenticación)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/login` | Iniciar sesión → devuelve JWT + refresh token |
| POST | `/auth/refresh` | Renovar JWT con refresh token |
| POST | `/users/register` | Registro de ciudadano (paso 1: datos) |
| POST | `/users/verify-email` | Verificar OTP de email |
| POST | `/users/set-password` | Wizard de registro (paso 3: contraseña) |
| POST | `/auth/forgot-password` | Solicitar OTP de recuperación de contraseña |
| POST | `/auth/verify-reset-otp` | Verificar OTP de reset |
| POST | `/auth/reset-password` | Cambiar contraseña con OTP |
| GET/HEAD | `/media/{bucket}/{key}` | Proxy de imágenes desde R2 |

### Rutas ciudadano (rol: CIUDADANO)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/ml/pre-check` | Pre-screening de imagen antes de reportar |
| POST | `/image/analyze` | Crear incidente + iniciar análisis ML (HTTP 202) |
| GET | `/image/status/{task_id}` | Polling del estado del análisis |
| GET | `/incidents/me` | Historial de incidentes del ciudadano |
| GET | `/incidents/me/{id}` | Detalle de un incidente por ID |
| GET | `/incidents/notifications` | Lista de notificaciones del ciudadano |
| PUT | `/incidents/notifications/{id}/read` | Marcar notificación como leída |
| PUT | `/incidents/notifications/read-all` | Marcar todas como leídas |

### Rutas supervisor (rol: SUPERVISOR)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/supervisor/incidents` | Listado paginado con filtros |
| GET | `/supervisor/incidents/{id}` | Detalle completo con historial y feedback |
| PUT | `/supervisor/incidents/{id}/estado` | Cambiar estado (requiere `motivo_rechazo` si RECHAZADA) |
| POST | `/supervisor/incidents/{id}/asignar` | Asignar a operario |
| PUT | `/supervisor/incidents/{id}/revision-ia` | Registrar veredicto sobre la IA |
| GET | `/supervisor/operarios` | Lista de operarios disponibles |
| GET | `/supervisor/zonas/estadisticas` | Estadísticas por zona geográfica |
| GET | `/supervisor/ia/estadisticas` | Estadísticas del rendimiento de la IA |
| GET | `/supervisor/ia/imagenes` | Auditoría de imágenes para reentrenamiento |
| GET | `/supervisor/ia/hard-examples` | Casos difíciles para active learning |

---

## 8. Ciclo de Vida de un Incidente

### Desde la app (ciudadano)

1. **Pre-check:** el ciudadano encuadra la foto; la app envía un thumbnail al backend y muestra si "parece basura".
2. **Reportar:** el ciudadano confirma → la app sube la imagen completa y recibe un `task_id` (HTTP 202).
3. **Polling:** la app consulta `GET /image/status/{task_id}` cada pocos segundos.
4. **Resultado:**
   - **PENDIENTE** → "¡Análisis listo! Tu reporte fue aceptado" → se abre ScanResultScreen.
   - **DESCARTADO** → "Sin acumulación detectada" (alerta, no navega).
   - **EN_REVISION** → "Reporte en revisión, un supervisor decidirá pronto" (alerta).
   - **FALLIDO** → "Error técnico, intenta de nuevo" (alerta).

### Desde el panel supervisor

1. Bandeja de incidentes filtra los casos `EN_REVISION` (flujo principal) y `PENDIENTE`.
2. **Paso 1 — Validar:** el supervisor ve la imagen y decide:
   - "Es un reporte real" → pasa a Paso 2.
   - "No es real / descartar" → selecciona motivo del dropdown y confirma → estado `RECHAZADA`.
3. **Paso 2 — Clasificar:** ajusta nivel de acumulación, tipo de residuo y prioridad.
4. **Paso 3 — Asignar:** selecciona operario de campo y fecha esperada.

### Notificaciones al ciudadano

El sistema envía notificaciones push (FCM/APNs) y en-app en los siguientes eventos:

| Evento | Título | Descripción |
|---|---|---|
| Reporte aceptado (PENDIENTE) | Reporte aceptado | "Tu reporte fue validado. Prioridad asignada: X." |
| Reporte rechazado (RECHAZADA) | Reporte rechazado | "Tu reporte fue revisado y no pudo ser atendido en esta ocasión." |
| En atención | Reporte en atención | "Un equipo de campo ha sido asignado a tu reporte." |
| Resuelto | Reporte resuelto | "¡El problema de basura que reportaste ha sido atendido!" |
| Sin residuos (DESCARTADO) | Imagen sin residuos detectados | "El análisis automático no detectó acumulación de residuos." |

---

## 9. Seguridad y Cumplimiento

### Autenticación y autorización

- **JWT** con expiración de 1 hora + **refresh tokens** de 7 días (rotación en cada uso).
- 4 roles: `CIUDADANO`, `OPERARIO`, `SUPERVISOR`, `ADMIN`.
- El gateway verifica el JWT en cada request protegido antes de hacer proxy.
- Token inter-microservicio (`INTERNAL_TOKEN`) para comunicaciones backend-to-backend.

### Rate limiting (Redis)

| Endpoint | Límite | Ventana |
|---|---|---|
| Login / Auth general | 10 req | 15 min |
| Registro | 3 req | 1 hora |
| OTP | 5 req | 15 min |
| Forgot-password | 5 req | 1 hora |
| Análisis de imagen | 20 req | 1 hora |

### LOPDP (Ley Orgánica de Protección de Datos Personales — Ecuador)

| Medida | Implementación |
|---|---|
| Cifrado de PII | Cédula y teléfono cifrados con `pgcrypto` en PostgreSQL |
| Registro de auditoría | Schema `audit` registra todas las acciones sensibles (Art. 39) |
| Funciones ARCO | Supresión y portabilidad de datos por usuario (migración 022) |
| Consentimiento | Tabla `user_consents` registra aceptación de política |
| Retención de datos | Política de retención configurable (migración 026) |

### Headers de seguridad

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

---

## 10. Infraestructura y DevOps

### Límites de recursos Docker (producción)

| Servicio | CPU | Memoria |
|---|---|---|
| ML API (FastAPI) | 2.0 | 2 GB |
| ML Worker (Celery) | 4.0 | 4 GB |
| Resto de servicios | sin límite explícito | sin límite explícito |

### Health checks

Todos los servicios tienen healthcheck automático en Docker. El gateway solo recibe tráfico cuando todos los dependientes están `healthy`.

| Servicio | Endpoint | Intervalo |
|---|---|---|
| API Gateway | `GET /health` | 30 s |
| Auth / Users / Image | `GET /health` | 30 s |
| ML API | `GET /health` (curl) | 30 s |
| ML Worker | `celery inspect ping` | 60 s |
| Redis | `redis-cli ping` | 10 s |

### Actualizar el backend en producción

```bash
# En el VPS:
cd /opt/mic-emaseo
git stash                                          # guardar cambios locales si los hay
git pull origin main
git stash pop                                      # restaurar cambios locales
docker compose -f docker-compose.prod.yml pull    # descargar nuevas imágenes de GHCR
docker compose -f docker-compose.prod.yml up -d --no-deps image-service   # ejemplo: solo image-service
# o para todos los servicios:
docker compose -f docker-compose.prod.yml up -d
```

### Aplicar una migración de base de datos

1. Abrir Supabase SQL Editor: https://supabase.com/dashboard/project/racsklqvunereluevwfp/sql
2. Pegar el contenido del archivo `Backend/database/0XX_nombre.sql`
3. Ejecutar — todas las migraciones son idempotentes (`IF NOT EXISTS`)

### Redesplegar los paneles web (Cloudflare Pages)

```bash
# Panel supervisor:
cd Frontend/supervisor-panel
npm run build
npx wrangler pages deploy dist --project-name mic-emaseo-panel --commit-dirty=true

# Panel administrador:
cd Frontend/admin-panel
npm run build
npx wrangler pages deploy dist --project-name mic-emaseo-admin --commit-dirty=true
```

---

## 11. Variables de Entorno Críticas

### API Gateway (`.env` en VPS)

| Variable | Descripción |
|---|---|
| `JWT_SECRET` | Clave de firma de tokens JWT |
| `INTERNAL_TOKEN` | Token inter-microservicios |
| `CORS_ORIGINS` | Origins permitidos (separados por coma) |
| `REDIS_URL` | URL de Redis con contraseña (rate-limiting) |
| `AUTH_SERVICE_URL` | `http://auth-service:3002` |
| `USERS_SERVICE_URL` | `http://users-service:3000` |
| `IMAGE_SERVICE_URL` | `http://image-service:5000` |
| `ML_SERVICE_URL` | `http://ml-api:8000` |

### Image Service

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión PostgreSQL (Supabase) |
| `S3_PUBLIC_URL` | URL pública de Cloudflare R2 (sin barra final, sin nombre de bucket) |
| `S3_BUCKET` | `emaseo-incidents` |
| `AWS_ACCESS_KEY_ID` | Credencial R2 |
| `AWS_SECRET_ACCESS_KEY` | Credencial R2 |
| `AWS_REGION` | `auto` (Cloudflare R2) |
| `S3_ENDPOINT_URL` | Endpoint interno R2 |

### ML Service

| Variable | Descripción |
|---|---|
| `SEMANTIC_REJECT_THRESHOLD` | Default `0.30` — umbral CLIP para descarte automático |
| `SEMANTIC_REVIEW_THRESHOLD` | Default `0.62` — umbral CLIP para revisión humana |
| `BLUR_VARIANCE_MIN` | Default `80.0` — varianza Laplaciano mínima |
| `MIN_COVERAGE_UNION` | Default `0.03` — cobertura mínima del frame (3 %) |
| `PRE_CHECK_THRESHOLD` | Default `0.35` — umbral garbage_score del pre-check |
| `DUMMY_MODE` | `false` en prod; `true` para pruebas sin modelo |
| `REDIS_HOST` | `redis` (nombre del contenedor Docker) |

### Frontend (Cloudflare Pages / build)

| Variable | Descripción |
|---|---|
| `VITE_API_URL` | `https://micemaseo.duckdns.org/api` |

### App móvil (EAS build)

| Variable | Descripción |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://micemaseo.duckdns.org/api` |

---

## 12. Glosario

| Término | Definición |
|---|---|
| **RT-DETR-L** | Real-Time Detection Transformer Large. Modelo de detección de objetos de Baidu, sucede a YOLO en precisión. Detecta bboxes de residuos. |
| **CLIP ViT-B/32** | Contrastive Language-Image Pre-training de OpenAI. Gate semántico que compara la imagen contra prompts de texto para distinguir basura de otras escenas. Pesos: LAION-2B. |
| **MiDaS_small** | Modelo de estimación de profundidad monocular de Intel. Se usa para calcular el volumen en m³ de la acumulación a partir de una sola imagen. |
| **Celery** | Framework de colas de tareas async para Python. Las inferencias pesadas se procesan en un worker Celery para no bloquear la API. |
| **NMS** | Non-Maximum Suppression. Filtro post-detección que elimina bboxes solapadas, quedándose con la de mayor confianza. |
| **garbage_score** | Puntuación [0–1] de aspecto visual de basura, calculada combinando entropía de color, densidad de bordes y posición en el frame. |
| **DESCARTADO** | Estado automático: la IA está segura de que no hay basura (CLIP < 0.30 o confianza ≥ 0.70 en rechazo). El supervisor puede anularlo. |
| **EN_REVISION** | Estado que indica que la IA no está segura: la imagen pasa a la bandeja del supervisor para decisión humana. |
| **OTA** | Over-The-Air update. Actualización de la app móvil que se descarga automáticamente sin reinstalar el APK. |
| **EAS** | Expo Application Services. Plataforma de Expo para compilar apps nativas y publicar OTAs. |
| **Wrangler** | CLI de Cloudflare para desplegar Workers, Pages y gestionar R2. |
| **R2** | Almacenamiento de objetos de Cloudflare, compatible con AWS S3 API. Sin costos de egress. |
| **pgBouncer** | Pool de conexiones PostgreSQL. Supabase lo expone en el puerto 6543. |
| **LOPDP** | Ley Orgánica de Protección de Datos Personales de Ecuador. Regula el tratamiento de datos personales. |
| **DuckDNS** | Servicio gratuito de DNS dinámico. Permite usar un dominio fijo (`micemaseo.duckdns.org`) aunque la IP del VPS cambie. |
| **GHCR** | GitHub Container Registry. Almacena las imágenes Docker del proyecto. |
| **Confianza IA** | Número entre 0 % y 100 % que indica qué tan seguro está el modelo de que la imagen muestra basura. 0 % = no detectó nada. |
