# Users Service — Arquitectura

## 1. Arquitectura del sistema

El Users Service gestiona el **dominio de usuarios** de la plataforma: registro de ciudadanos, perfiles, gestión de operarios y supervisores, zonas PostGIS, y push tokens para notificaciones. Es el servicio más orientado a datos de las personas que interactúan con el sistema.

```
api-gateway :4000
  │  /api/users/*
  │  X-Internal-Token
  ▼
users-service :3000
  │
  ├── app.ciudadanos       (PostgreSQL)
  ├── app.operarios        (PostgreSQL)
  ├── app.supervisores     (PostgreSQL)
  ├── app.zones            (PostGIS)
  └── SMTP (Nodemailer)    — OTP de verificación de email
```

**Ruta raíz:** `Backend/users-service/`
**Puerto:** 3000
**Runtime:** Node.js 22 + Express 5.2.1
**Base de datos:** Schema `app` en PostgreSQL + PostGIS

---

## 2. Estilo de arquitectura

| Patrón | Aplicación |
|---|---|
| **Microservicio de dominio** | Dueño del dato de usuarios, perfiles y zonas |
| **Layered** | routes → controllers → db |
| **Self-registration flow** | Ciudadano se registra sin intervención de admin (3 pasos) |
| **Spatial** | Zonas como polígonos PostGIS; asignación automática por geolocalización |

---

## 3. Decisiones arquitectónicas

### 3.1 Consolidación en `app_auth.users` (migración 056)
Históricamente existían tablas separadas `app.ciudadanos`, `app.operarios`, `app.supervisores`. La migración 056 las consolidó en una sola tabla `app_auth.users` con columna `rol`. Los controladores del users-service leen/escriben a través de vistas o joins que abstraen esto.

**Por qué:** Eliminar duplicidad de credenciales entre schemas, simplificar consultas de perfil y gestión de roles.

### 3.2 Registro ciudadano en 3 pasos
El flujo es: `POST /register` → OTP por email → `POST /verify-email` → `POST /set-password`. No requiere aprobación de admin.

**Por qué:** Verifica que el email existe antes de crear la cuenta definitiva. Evita registros con emails falsos.

### 3.3 Validación de cédula ecuatoriana
El módulo `cedula.js` implementa el algoritmo oficial del módulo 11 para validar cédulas de 10 dígitos. Se valida en registro de ciudadanos, operarios y supervisores.

### 3.4 Push tokens por ciudadano
El endpoint `POST /push-token` registra el token de Expo/FCM del dispositivo en la columna `push_token` del ciudadano. Esto permite que el notification worker del image-service envíe notificaciones push sin consultar una tabla separada.

### 3.5 Asignación automática a zona por GPS
Un trigger PostGIS en `app.ciudadanos` evalúa `ST_Within(point, zona.geometria)` al insertar/actualizar las coordenadas del ciudadano. Asigna `zona_id` automáticamente.

### 3.6 Separación de roles BD
El usuario de BD `users_svc` tiene acceso únicamente al schema `app`. No puede leer `app_auth` (contraseñas) ni `audit` (logs de seguridad).

---

## 4. Comunicación interna y externa

### Tráfico permitido
Solo acepta peticiones del gateway con `X-Internal-Token`. No hay endpoints públicos directos.

```
[api-gateway]
  │  X-Internal-Token
  ├── /api/users/*      → user.controller.js
  ├── /api/operarios/*  → operarios.controller.js
  ├── /api/supervisores → supervisor.controller.js
  └── /api/zones/*      → zone.controller.js
         │
         ▼
    [PostgreSQL + PostGIS]
         │
         ▼
    [SMTP — OTP de verificación]
```

### Eventos de dominio hacia otros servicios
El users-service NO publica eventos. Es consultado pasivamente por el gateway. El image-service lee `push_token` directamente de la BD (mismo PostgreSQL, diferente schema, usuario con GRANT SELECT).

---

## 5. Funcionalidades

### 5.1 Registro de ciudadano (flujo 3 pasos)
```
Paso 1 — Solicitar registro:
POST /api/users/register
Body: { email, nombre, cedula, telefono }
→ Valida cédula (módulo 11 ecuatoriano)
→ Genera OTP de verificación
→ Envía email
→ Crea registro en estado PENDIENTE_VERIFICACION

Paso 2 — Verificar email:
POST /api/users/verify-email
Body: { email, otp }
→ { valid: true/false }

Paso 3 — Establecer contraseña:
POST /api/users/set-password
Body: { email, password }
→ Crea entrada en app_auth.usuarios con rol CIUDADANO
→ Activa el estado del ciudadano
```

### 5.2 Push token
```
POST /api/users/push-token
Header: Authorization: Bearer <JWT>  (ciudadano autenticado)
Body: { token, platform }  -- platform: "android" | "ios"
→ Actualiza push_token y push_platform en la fila del ciudadano
```

### 5.3 Perfil del ciudadano
```
GET /api/users/profile
→ Retorna datos completos: nombre, email, cedula, telefono, zona, estado

PUT /api/users/profile
Body: { nombre, telefono }
→ Actualiza solo campos permitidos (no email, no cédula)
```

### 5.4 Gestión de ciudadanos (admin)
```
GET  /api/users/ciudadanos             → Listado paginado (filtrable por estado)
PUT  /api/users/ciudadanos/:id/estado  → { estado: 'ACTIVO'|'INACTIVO'|'SUSPENDIDO' }
POST /api/users/ciudadanos/:id/reset-password → Genera password temporal, envía email
```

### 5.5 Gestión de operarios (admin)
```
GET    /api/operarios             → Lista todos con zona y supervisor
POST   /api/operarios             → Crea operario (+ crea entrada en app_auth)
PUT    /api/operarios/:id         → Edita datos
PUT    /api/operarios/:id/estado  → Activar/Desactivar
DELETE /api/operarios/:id         → Soft delete (estado INACTIVO)
```

### 5.6 Gestión de supervisores (admin)
```
GET    /api/supervisores             → Lista con zona asignada
POST   /api/supervisores             → Crea supervisor (+ app_auth)
PUT    /api/supervisores/:id         → Edita datos
PUT    /api/supervisores/:id/estado
DELETE /api/supervisores/:id
```

### 5.7 Gestión de zonas (admin)
```
GET    /api/zones             → Lista con geometría GeoJSON
POST   /api/zones             → Crea zona (acepta GeoJSON Polygon/MultiPolygon)
PUT    /api/zones/:id         → Edita nombre, geometría, supervisor asignado
DELETE /api/zones/:id
```

Zonas importadas desde OpenStreetMap (73 zonas de Quito, migración 051, MultiPolygon real).

### 5.8 Healthcheck
```
GET /health → 200 { status: "ok" }
```

---

## 6. Otros aspectos importantes

### Tablas principales

```sql
-- Ciudadanos (datos de perfil)
app.ciudadanos
  id, email, nombre, cedula, telefono
  estado       ENUM('ACTIVO','INACTIVO','SUSPENDIDO','PENDIENTE_VERIFICACION')
  latitud, longitud         -- última ubicación conocida
  push_token, push_platform -- para notificaciones
  zona_id      FK → app.zones
  created_at, updated_at

-- Operarios
app.operarios
  id, email, nombre, cedula, telefono
  estado       ENUM('ACTIVO','INACTIVO')
  supervisor_id FK → app.supervisores
  zona_id       FK → app.zones
  created_at, updated_at

-- Supervisores
app.supervisores
  id, email, nombre, cedula, telefono
  estado       ENUM('ACTIVO','INACTIVO')
  zona_id      FK → app.zones
  created_at, updated_at

-- Zonas (PostGIS)
app.zones
  id, nombre
  geometria    GEOMETRY(MultiPolygon, 4326)
  supervisor_id FK → app.supervisores
  created_at, updated_at
```

### Variables de entorno requeridas
```env
PORT=3000
JWT_SECRET=...
INTERNAL_TOKEN=...
DB_USER=users_svc
DB_HOST=postgres
DB_NAME=MIC-EMASEO
DB_PASSWORD=...
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=EMASEO EP <...>
```

### Dependencias clave
```
pg: ^8.20.0
bcryptjs: ^3.0.3     -- hash para contraseñas de operarios/supervisores creados por admin
jsonwebtoken: ^9.0.3
nodemailer: ^8.0.5
express: ^5.2.1
pino: ^9.6.0
```

### Estructura de archivos
```
Backend/users-service/src/
├── app.js
├── db.js
├── controllers/
│   ├── user.controller.js         # Ciudadanos (registro, perfil, push-token)
│   ├── operarios.controller.js    # CRUD operarios
│   ├── supervisor.controller.js   # CRUD supervisores
│   └── zone.controller.js         # CRUD zonas PostGIS
├── routes/
│   ├── user.routes.js
│   ├── operarios.routes.js
│   ├── supervisor.routes.js
│   └── zone.routes.js
├── middleware/
│   ├── internalAuth.middleware.js
│   └── requestId.middleware.js
└── utils/
    ├── cedula.js                  # Validación cédula ecuatoriana (módulo 11)
    ├── mailer.js
    ├── passwordValidator.js
    └── logger.js
```

### PostGIS — consultas frecuentes
```sql
-- Asignación automática de zona al ciudadano
UPDATE app.ciudadanos
SET zona_id = (
  SELECT id FROM app.zones
  WHERE ST_Within(ST_SetSRID(ST_MakePoint($lon, $lat), 4326), geometria)
  LIMIT 1
)
WHERE id = $ciudadano_id;

-- Verificar si punto está dentro de zona (geocerca cierre)
SELECT ST_Within(
  ST_SetSRID(ST_MakePoint($lon, $lat), 4326),
  geometria
) FROM app.zones WHERE id = $zona_id;
```
