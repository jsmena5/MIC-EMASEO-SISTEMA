# API Gateway — Arquitectura

## 1. Arquitectura del sistema

El API Gateway es el **punto de entrada único** (single entry point) de la plataforma MIC-EMASEO. Toda petición HTTP del exterior — app móvil, paneles web, integraciones — pasa por aquí antes de llegar a cualquier microservicio interno.

```
Internet
  │
  ▼
[Cloudflare Tunnel / Caddy TLS]
  │
  ▼  :4000
[api-gateway]
  ├── /api/auth/*      ──► auth-service     :3002
  ├── /api/users/*     ──► users-service    :3000
  ├── /api/image/*
  ├── /api/incidents/* ──► image-service    :5000
  ├── /api/supervisor/*
  ├── /api/operario/*
  ├── /api/ml/*        ──► ml-service       :8000
  └── /api/media/*     ──► MinIO/R2         :9000
```

**Ruta raíz:** `Backend/api-gateway/`
**Puerto:** 4000
**Runtime:** Node.js 22 + Express 5.2.1

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **API Gateway / BFF** | Único punto de entrada; adapta respuestas al cliente |
| **Proxy reverso** | Delega al microservicio dueño del recurso (http-proxy-middleware) |
| **Edge security** | JWT + RBAC se validan aquí; los servicios internos confían en X-Internal-Token |
| **Rate limiting distribuido** | Redis como backend de contadores; coherente entre réplicas |

El gateway **no tiene base de datos propia**. Es stateless excepto por el estado del rate limiter en Redis.

---

## 3. Decisiones arquitectónicas

### 3.1 JWT validado en el gateway (no en cada servicio)
Los microservicios internos reciben solo un `X-Internal-Token` estático. Esto centraliza la lógica de autenticación y evita duplicar la dependencia de `jsonwebtoken` en cada servicio con las mismas claves.

**Trade-off:** Si el gateway cae, nadie puede autenticarse. Mitigado con Docker healthcheck + restart policy.

### 3.2 RBAC en middleware (no en BD)
Los roles se extraen del JWT y se aplican con funciones `requireCiudadano`, `requireAdmin`, etc. No hay consulta a BD en el gateway.

**Trade-off:** Los cambios de rol no surten efecto hasta que expira el access token (15 min). Aceptable para el caso de uso.

### 3.3 Proxy de medias en el gateway
`GET /api/media/:bucket/:key` descarga el objeto de MinIO/R2 y lo reenvía al cliente. Esto oculta las credenciales de almacenamiento y permite políticas de caché consistentes.

**Por qué:** Cloudflare R2 no tiene URLs públicas por defecto en el plan usado; el proxy las sirve con `Cache-Control: public, max-age=31536000, immutable`.

### 3.4 Rate limiting granular por endpoint
Seis limitadores distintos con Redis backend:

| Limitador | Máx | Ventana |
|---|---|---|
| globalLimiter | 1000 req | 15 min |
| authLimiter | 10 req | 15 min |
| registrationLimiter | 5 req | 1 hora |
| otpLimiter | 10 req | 15 min |
| forgotPasswordLimiter | 5 req | 1 hora |
| passwordResetLimiter | 5 req | 15 min |

**Por qué Redis y no memoria:** En un entorno con múltiples réplicas del gateway los contadores en memoria son independientes por proceso. Redis garantiza coherencia global.

### 3.5 Fail-fast en arranque
Si alguna variable de entorno obligatoria falta (`JWT_SECRET`, `AUTH_SERVICE_URL`, etc.) el proceso termina con `process.exit(1)` antes de aceptar conexiones. Evita arrancar en un estado parcialmente configurado.

### 3.6 Logging sanitizado con Pino
Los campos `password`, `otp`, `token`, `refreshToken` se reemplazan por `[REDACTED]` antes de escribir en el log. Pino usa JSON estructurado para facilitar ingestión en ELK/Grafana.

---

## 4. Comunicación interna y externa

### Externa (clientes → gateway)
- **Protocolo:** HTTPS (TLS terminado en Cloudflare/Caddy; gateway recibe HTTP en red interna)
- **Autenticación:** `Authorization: Bearer <JWT>` en la mayoría de endpoints
- **Formato:** JSON (`Content-Type: application/json`)
- **trust proxy:** 1 — lee `X-Forwarded-For` para extraer IP real (rate limiting correcto detrás de Cloudflare)

### Interna (gateway → microservicios)
- **Protocolo:** HTTP/1.1 en la red Docker `emaseo_network`
- **Autenticación:** Header `X-Internal-Token` (secreto compartido, nunca sale al exterior)
- **Propagación de identidad:** Gateway inyecta `X-User-Id`, `X-User-Rol`, `X-Request-ID` en cada proxy request
- **Timeout proxy de medias:** 15 s

### Diagrama de headers
```
Cliente
  │  Authorization: Bearer <JWT>
  ▼
api-gateway
  │  X-Internal-Token: <secreto>
  │  X-User-Id: 42
  │  X-User-Rol: CIUDADANO
  │  X-Request-ID: uuid-v4
  ▼
microservicio
```

---

## 5. Funcionalidades

### 5.1 Proxy de APIs
Reenvía peticiones a los servicios internos según el prefijo de ruta. Soporta todos los métodos HTTP. Streaming habilitado para respuestas grandes.

### 5.2 Autenticación JWT
```
verifyToken (middleware)
  1. Extrae Bearer del header Authorization
  2. jwt.verify(token, JWT_SECRET)
  3. Adjunta payload en req.user
  4. Llama next() o responde 401/403
```

### 5.3 RBAC
```
requireCiudadano   → rol === 'CIUDADANO'
requireOperario    → rol === 'OPERARIO'
requireSupervisor  → rol === 'SUPERVISOR'
requireAdmin       → rol === 'ADMIN'
requireStaff       → rol IN ('OPERARIO','SUPERVISOR','ADMIN')
```

### 5.4 Proxy de medias
```
GET /api/media/:bucket/:key
  → descarga objeto de MinIO/R2
  → reenvía stream con headers de caché
  → Cache-Control: public, immutable, max-age=31536000
```

### 5.5 Documentación Swagger
```
GET /docs        → Swagger UI
GET /api-docs    → JSON OpenAPI 3.0
```

### 5.6 Healthcheck
```
GET /health → 200 { status: "ok", timestamp }
```

---

## 6. Otros aspectos importantes

### Variables de entorno requeridas
```env
PORT=4000
JWT_SECRET=...
INTERNAL_TOKEN=...
AUTH_SERVICE_URL=http://auth-service:3002
USERS_SERVICE_URL=http://users-service:3000
IMAGE_SERVICE_URL=http://image-service:5000
ML_SERVICE_URL=http://ml-api:8000
MINIO_INTERNAL_URL=http://minio:9000
CORS_ORIGINS=https://admin.emaseo.ec,https://supervisor.emaseo.ec
PUBLIC_API_URL=https://api.emaseo.ec
REDIS_URL=redis://:<pw>@redis:6379/1
```

### Dependencias clave
```
express: ^5.2.1
http-proxy-middleware: ^3.0.5
jsonwebtoken: ^9.0.3
express-rate-limit: ^8.3.2
rate-limit-redis: ^4.3.1
redis: ^5.12.1
helmet: ^8.1.0
pino: ^9.6.0
swagger-jsdoc: ^6.2.8
```

### Seguridad (Helmet)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- CSP configurado para Swagger UI

### CORS
Dinámico: en `NODE_ENV=development` permite `localhost:*`; en producción solo los dominios listados en `CORS_ORIGINS`.

### Escalabilidad
El gateway es stateless (el estado de rate limiting vive en Redis). Se puede escalar horizontalmente con múltiples réplicas detrás de un load balancer sin cambios de código.

### Estructura de archivos
```
Backend/api-gateway/src/
├── index.js                    # Entry point, configuración Express, rutas proxy
├── swagger.js                  # Spec OpenAPI
├── middlewares/
│   ├── auth.middleware.js       # verifyToken
│   ├── rbac.middleware.js       # requireXxx
│   ├── rateLimiter.js           # 6 limitadores Redis
│   └── requestId.middleware.js  # X-Request-ID
└── utils/
    └── logger.js                # Pino con sanitización
```
