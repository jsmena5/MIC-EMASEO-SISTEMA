# Auth Service — Arquitectura

## 1. Arquitectura del sistema

El Auth Service es el microservicio responsable de **autenticación** en la plataforma MIC-EMASEO. Gestiona el ciclo de vida de las sesiones de usuario: login, refresh de tokens, logout y el flujo completo de recuperación de contraseña mediante OTP por email.

```
api-gateway :4000
  │  POST /api/auth/*
  │  X-Internal-Token
  ▼
auth-service :3002
  │
  ├── app_auth.usuarios  (PostgreSQL)
  └── SMTP (Nodemailer / Gmail)
```

**Ruta raíz:** `Backend/auth-service/`
**Puerto:** 3002
**Runtime:** Node.js 22 + Express 5.2.1
**Base de datos:** Schema `app_auth` en PostgreSQL/PostGIS

---

## 2. Estilo de arquitectura
oot@vmi3331168:/opt/mic-emaseo# cat /opt/mic-emaseo/.env | grep POSTGRES
root@vmi3331168:/opt/mic-emaseo# ^C
root@vmi3331168:/opt/mic-emaseo# docker volume ls | grep postgres && docker inspect emaseo-postgres | grep -A5 Mounts
local     emaseo_postgres_data
        "Mounts": [
            {
                "Type": "bind",
                "Source": "/opt/mic-emaseo/Backend/database/024_pgcrypto_pii.sql",
                "Destination": "/docker-entrypoint-initdb.d/18_pgcrypto_pii.sql",
                "Mode": "rw",
root@vmi3331168:/opt/mic-emaseo#

| Patrón | Aplicación |
|---|---|
| **Microservicio de dominio** | Responsabilidad única: autenticación |
| **Layered (capas)** | routes → controllers → db/utils |
| **Token-based auth** | JWT access (15 min) + refresh opaco (7 días) |
| **Internal-only** | Solo recibe tráfico del gateway con `X-Internal-Token` |

No tiene lógica de negocio de dominio (incidentes, zonas, etc.). Todo lo que maneja son credenciales y tokens.

---

## 3. Decisiones arquitectónicas

### 3.1 Schema separado `app_auth`
Las credenciales viven en un schema PostgreSQL propio (`app_auth.usuarios`) con un usuario de BD aislado (`auth_svc`). Los otros servicios no tienen acceso a este schema.

**Por qué:** Principio de mínimo privilegio. Una vulnerabilidad en image-service o users-service no puede leer hashes de contraseñas.

### 3.2 Tokens duales: JWT corto + refresh opaco
- **Access token (JWT, 15 min):** Firmado con `JWT_SECRET`, autodescriptivo, validado en el gateway sin BD.
- **Refresh token (opaco, 7 días):** Almacenado como hash en la fila del usuario. En cada refresh se rota (invalidando el anterior).

**Por qué refresh opaco y no JWT:** El refresh JWT no puede invalidarse antes de expirar sin una lista de revocación. El token opaco se invalida simplemente actualizando la columna en BD.

### 3.3 Anti-enumeración en login
El endpoint `POST /login` devuelve el mismo mensaje genérico para credenciales incorrectas independientemente de si el email existe o no.

**Por qué:** Evita que un atacante pueda descubrir qué emails tienen cuenta mediante timing attacks o mensajes diferentes.

### 3.4 OTP de 6 dígitos con CSPRNG
Los códigos de recuperación se generan con `crypto.randomInt` (CSPRNG del SO), no con `Math.random`. Validez: 10 minutos. Se almacenan en texto plano en la columna `otp_codigo` (son de un solo uso y expiran).

### 3.5 Bcrypt con 10 rounds
Equilibrio entre seguridad (2^10 iteraciones) y latencia de login (<300ms en hardware de desarrollo). Configurable con `BCRYPT_ROUNDS`.

### 3.6 Separación auth / users
El auth-service solo conoce email + contraseña + rol + estado. Los datos del perfil (nombre, cédula, teléfono, zona) viven en users-service. Esta separación permite actualizar la estrategia de autenticación sin tocar el dominio de usuarios.

---

## 4. Comunicación interna y externa

### Solo acepta tráfico interno
El auth-service no está expuesto directamente a Internet. Todo pasa por el gateway.

```
[cliente móvil/web]
  │  HTTPS + Bearer JWT
  ▼
[api-gateway :4000]
  │  HTTP interno
  │  X-Internal-Token: <secreto>
  ▼
[auth-service :3002]
  │
  ├── [PostgreSQL] SELECT/UPDATE app_auth.usuarios
  └── [SMTP] envío de OTP por email
```

### Middleware de autenticación interna
```javascript
// internalAuth.middleware.js
if (req.headers['x-internal-token'] !== process.env.INTERNAL_TOKEN)
  return res.status(403).json({ error: 'Forbidden' })
```

### Eventos de auditoría
El servicio escribe en `audit.audit_log` al completar:
- `LOGIN` exitoso
- `CHANGE_PASSWORD`
- `RESET_PASSWORD`

Campos auditados: `actor_ip`, `user_agent`, `timestamp`.

---

## 5. Funcionalidades

### 5.1 Login
```
POST /api/auth/login
Body: { email, password }
Respuesta: { token, refreshToken, user: { id, rol, nombre } }

Flujo:
1. Busca usuario por email en app_auth.usuarios
2. Verifica estado === 'ACTIVO'
3. bcrypt.compare(password, hash)
4. Genera JWT (15 min) con payload { id, rol, username }
5. Genera refresh token opaco (32 bytes hex)
6. Guarda hash del refresh token en BD
7. Registra evento en audit.audit_log
```

### 5.2 Refresh de token
```
POST /api/auth/refresh
Body: { refreshToken }
Respuesta: { token, refreshToken }

Flujo:
1. Busca usuario cuyo refresh_token_hash coincide
2. Verifica que no haya expirado (refresh_token_expires_at)
3. Genera nuevo par (token JWT + refresh opaco)
4. Actualiza la fila (rotación: invalida anterior)
```

### 5.3 Logout
```
POST /api/auth/logout
Header: Authorization: Bearer <JWT>
Respuesta: { message: "ok" }

Flujo:
1. Extrae id del JWT
2. Borra refresh_token_hash de la fila del usuario
```

### 5.4 Recuperación de contraseña (3 pasos)
```
Paso 1 — Solicitar OTP:
POST /api/auth/forgot-password
Body: { email }
→ Genera OTP 6 dígitos (CSPRNG)
→ Guarda en otp_codigo + otp_expira_en (ahora + 10 min)
→ Envía email con código

Paso 2 — Verificar OTP:
POST /api/auth/verify-reset-otp
Body: { email, otp }
→ { valid: true/false }

Paso 3 — Restablecer:
POST /api/auth/reset-password
Body: { email, otp, newPassword }
→ Verifica OTP (no expirado, coincide)
→ bcrypt.hash(newPassword, rounds)
→ Actualiza contraseña_hash
→ Borra otp_codigo, otp_expira_en
→ Invalida refresh tokens activos
→ Registra evento en audit.audit_log
```

### 5.5 Cambio de contraseña (autenticado)
```
POST /api/auth/change-password
Header: Authorization: Bearer <JWT>
Body: { currentPassword, newPassword }
→ Verifica currentPassword contra hash
→ Valida que newPassword cumpla política
→ Actualiza hash
→ Registra en audit.audit_log
```

### 5.6 Healthcheck
```
GET /health → 200 { status: "ok" }
```

---

## 6. Otros aspectos importantes

### Tabla principal: `app_auth.usuarios`
```sql
id               SERIAL PRIMARY KEY
email            VARCHAR(255) UNIQUE NOT NULL
contraseña_hash  VARCHAR NOT NULL
nombre           VARCHAR(100)
telefono         VARCHAR(20)
rol              ENUM('CIUDADANO','OPERARIO','SUPERVISOR','ADMIN')
tipo_perfil      ENUM('ciudadano','operario')
estado           ENUM('ACTIVO','INACTIVO','SUSPENDIDO')
otp_codigo       VARCHAR(6)
otp_expira_en    TIMESTAMP WITH TIME ZONE
refresh_token    VARCHAR          -- almacena hash del token opaco
created_at       TIMESTAMP DEFAULT NOW()
updated_at       TIMESTAMP DEFAULT NOW()
```

### Política de contraseñas (`passwordValidator.js`)
- Mínimo 8 caracteres
- Al menos 1 mayúscula, 1 minúscula, 1 número

### Variables de entorno requeridas
```env
PORT=3002
JWT_SECRET=...
JWT_EXPIRES_IN=15m
BCRYPT_ROUNDS=10
INTERNAL_TOKEN=...
DB_USER=auth_svc
DB_HOST=postgres
DB_NAME=MIC-EMASEO
DB_PASSWORD=...
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...          # App Password de Gmail
EMAIL_FROM=EMASEO EP <...>
```

### Dependencias clave
```
bcryptjs: ^3.0.3
jsonwebtoken: ^9.0.3
nodemailer: ^8.0.5
pg: ^8.20.0
express: ^5.2.1
pino: ^9.6.0
```

### Estructura de archivos
```
Backend/auth-service/src/
├── index.js
├── db.js                          # Pool PostgreSQL (keepalive SELECT 1 cada 25s)
├── controllers/
│   └── auth.controller.js         # Toda la lógica de negocio
├── routes/
│   └── auth.routes.js
├── middleware/
│   ├── internalAuth.middleware.js
│   └── requestId.middleware.js
└── utils/
    ├── crypto.js                  # Helpers de encriptación
    ├── mailer.js                  # Nodemailer configurado
    └── passwordValidator.js
```

### Pool de conexiones
`db.js` configura un `pg.Pool` con `keepAlive: true` y un intervalo de SELECT 1 cada 25 segundos para evitar que PgBouncer cierre conexiones idle.
