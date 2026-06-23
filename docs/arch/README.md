# Arquitectura MIC-EMASEO — Índice

Sistema de detección y gestión de acumulación de basura para **EMASEO EP** (Quito, Ecuador).

---

## Documentos por componente

| Componente | Tipo | Puerto | Doc |
|---|---|---|---|
| [API Gateway](api-gateway.md) | Backend — Node.js | 4000 | Punto de entrada único, JWT, RBAC, proxy |
| [Auth Service](auth-service.md) | Backend — Node.js | 3002 | Login, refresh, OTP, reset password |
| [Users Service](users-service.md) | Backend — Node.js | 3000 | Ciudadanos, operarios, supervisores, zonas |
| [Image Service](image-service.md) | Backend — Node.js | 5000 | Incidentes, análisis, asignaciones, notificaciones |
| [ML Service](ml-service.md) | Backend — Python | 8000 / 50051 | RT-DETR, CLIP, MiDaS, Celery |
| [Admin Panel](admin-panel.md) | Frontend — React | Cloudflare Pages | Gestión del sistema (rol ADMIN) |
| [Supervisor Panel](supervisor-panel.md) | Frontend — React | Cloudflare Pages | Revisión de incidentes (rol SUPERVISOR) |
| [Mobile App](mobile-app.md) | Frontend — React Native | APK / EAS | Ciudadanos y operarios |

---

## Visión general del sistema

```
                          INTERNET
                             │
                    ┌────────▼─────────┐
                    │  Cloudflare CDN  │
                    │  (admin + super) │
                    └────────┬─────────┘
                             │
              ┌──────────────▼──────────────┐
              │       api-gateway :4000      │
              │  JWT · RBAC · Rate Limit     │
              └───┬────────┬────────┬────────┘
                  │        │        │
          ┌───────▼──┐ ┌───▼────┐ ┌─▼────────────────────┐
          │  auth    │ │ users  │ │    image-service       │
          │  :3002   │ │ :3000  │ │       :5000            │
          └───────┬──┘ └───┬────┘ └────────┬──────────────┘
                  │        │               │
          ┌───────▼────────▼───┐    ┌──────▼──────┐
          │    PostgreSQL      │    │  ml-service  │
          │  + PostGIS :5432   │    │  :8000/:50051│
          └────────────────────┘    └──────┬───────┘
                                           │
                                    ┌──────▼──────┐
                                    │    Redis     │
                                    │  (Celery)    │
                                    └─────────────┘
```

---

## Flujos principales

### Reporte de incidente (ciudadano)
```
App móvil → ScanScreen (VisionCamera)
         → crop + GPS
         → POST /api/ml/pre-check   (fail-closed, síncrono)
         → POST /api/image/analyze  (async, → task_id)
         → polling /status/:taskId  (cada 1s)
         → ScanResultScreen (tipo, nivel, prioridad)
```

### Revisión (supervisor)
```
Panel web → GET /api/supervisor/incidents?estado=PENDIENTE
          → Wizard 3 pasos: Validar → Firmar → Asignar
          → PUT /revision-ia
          → POST /asignar (operario)
```

### Resolución (operario)
```
App móvil → GET /api/operario/asignaciones
          → Acudir a ubicación
          → PUT /completar  (GPS requerido, geocerca 10m)
          → POST /feedback
```

---

## Infraestructura

| Servicio | Imagen Docker | Propósito |
|---|---|---|
| postgres | postgis:16-3.4 | Base de datos principal |
| redis | redis:7-alpine | Broker Celery + rate limit |
| minio | minio:latest | Almacenamiento local (dev) |
| api-gateway | GHCR | Puerto público |
| auth-service | GHCR | Interno |
| users-service | GHCR | Interno |
| image-service | GHCR | Interno |
| ml-api | GHCR | FastAPI |
| ml-worker | GHCR | Celery worker |
| flower | mher/flower:2.0 | Monitor Celery |

**Producción:** VPS Contabo `/opt/mic-emaseo`, Supabase (PostgreSQL), Cloudflare R2 (imágenes), Cloudflare Pages (paneles).

---

## Seguridad transversal

| Mecanismo | Dónde |
|---|---|
| JWT HS256 (15 min) | gateway (validación), auth-service (emisión) |
| Refresh token opaco (7 días, rotante) | auth-service |
| X-Internal-Token | Entre gateway y microservicios |
| Bcrypt 10 rounds | auth-service, users-service |
| Rate limiting Redis | gateway (6 limitadores distintos) |
| RBAC por middleware | gateway (requireXxx) |
| Row-Level Security | PostgreSQL (image_svc) |
| Auditoría | audit.audit_log (triggers) |
| Tokens en Secure Store | App móvil (Keychain/Keystore) |
| Geocerca de cierre | image-service (PostGIS ST_DWithin) |

---

## Roles y accesos

| Rol | App móvil | Supervisor Panel | Admin Panel |
|---|---|---|---|
| CIUDADANO | Reportar, historial, notificaciones | ✗ | ✗ |
| OPERARIO | Asignaciones, completar, feedback | ✗ | ✗ |
| SUPERVISOR | ✗ | Revisar, asignar, mapa | ✗ |
| ADMIN | ✗ | ✗ | Gestión completa, auditoría |

---

## Convenciones de estado (incidents)

```
PROCESANDO → PENDIENTE       (ML: INCIDENTE_VALIDO)
PROCESANDO → RECHAZADA       (ML: RECHAZO_CONFIABLE)
PROCESANDO → FALLIDO         (error técnico)
PENDIENTE  → EN_REVISION     (supervisor inicia)
EN_REVISION → EN_ATENCION   (operario asignado)
EN_ATENCION → RESUELTA      (operario completa, geocerca OK)
EN_ATENCION → DESCARTADO    (operario: no-atendible)
```
