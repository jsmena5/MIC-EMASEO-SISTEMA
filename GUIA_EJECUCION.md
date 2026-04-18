# Guía de Ejecución y Pruebas — MIC-EMASEO Sistema

Guía paso a paso para levantar el sistema completo en entorno local de desarrollo.

---

## Prerrequisitos

| Herramienta | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Python | 3.10+ | `python --version` |
| PostgreSQL | 15+ con **PostGIS** | `psql --version` |
| Expo Go | última | App Store / Play Store |

> **PostGIS** debe estar instalado como extensión de PostgreSQL. En Windows se instala
> desde el Stack Builder que incluye el instalador oficial de PostgreSQL.

---

## 1. Base de Datos

### 1.1 Crear la base de datos

```sql
-- En psql o pgAdmin, ejecutar como superusuario:
CREATE DATABASE "MIC-EMASEO";
```

### 1.2 Ejecutar migraciones en orden

Abrir la base de datos `MIC-EMASEO` y ejecutar los siguientes archivos en secuencia:

```
Backend/database/01_init_schema.sql   ← esquemas, tablas, ENUMs, índices
Backend/database/02_seed_data.sql     ← usuarios y datos de prueba
Backend/database/008_refresh_tokens.sql   ← tabla de refresh tokens
Backend/database/009_password_reset_tokens.sql  ← tabla OTP de recuperación
```

Con `psql` desde la raíz del proyecto:

```bash
psql -U postgres -d "MIC-EMASEO" -f Backend/database/01_init_schema.sql
psql -U postgres -d "MIC-EMASEO" -f Backend/database/02_seed_data.sql
psql -U postgres -d "MIC-EMASEO" -f Backend/database/008_refresh_tokens.sql
psql -U postgres -d "MIC-EMASEO" -f Backend/database/009_password_reset_tokens.sql
```

### 1.3 Usuarios de prueba (seed)

Todos los usuarios tienen password: **`Test1234!`**

| Email | Username | Rol |
|---|---|---|
| admin@emaseo.gob.ec | admin | ADMIN |
| maria.lopez@emaseo.gob.ec | m.lopez | SUPERVISOR |
| pedro.garcia@emaseo.gob.ec | p.garcia | OPERARIO |
| luis.martinez@emaseo.gob.ec | l.martinez | OPERARIO |
| ana.ciudadana@gmail.com | ana.c | CIUDADANO |
| jorge.ramirez@gmail.com | jorge.r | CIUDADANO |

---

## 2. Variables de Entorno

Cada servicio tiene un `.env.example`. Copiar y configurar:

### users-service

```bash
cp Backend/users-service/.env.example Backend/users-service/.env
```

```env
PORT=3000
JWT_SECRET=mic_emaseo_secret_2025
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=           # tu password de PostgreSQL
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=             # email Gmail para enviar OTPs
SMTP_PASS=             # contraseña de aplicación Gmail
EMAIL_FROM=EMASEO EP <tu_email@gmail.com>
```

### auth-service

```bash
cp Backend/auth-service/.env.example Backend/auth-service/.env
```

```env
PORT=3002
JWT_SECRET=mic_emaseo_secret_2025   # debe ser IGUAL al de users-service
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=EMASEO EP <tu_email@gmail.com>
```

### image-service

```bash
cp Backend/image-service/.env.example Backend/image-service/.env
```

```env
PORT=5000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=
DB_PORT=5432
ML_SERVICE_URL=http://localhost:8000/predict
```

### api-gateway

El api-gateway ya incluye un `.env` con valores por defecto. Verificar que `JWT_SECRET`
coincida con los demás servicios:

```env
JWT_SECRET=mic_emaseo_secret_2025
```

### Frontend (Expo)

Editar `Frontend/smart-waste-mobile/.env.development`:

```env
EXPO_PUBLIC_API_URL=http://<TU_IP_LOCAL>:4000/api
```

> **Importante:** reemplazar `<TU_IP_LOCAL>` con la IP de tu máquina en la red Wi-Fi
> (ejemplo: `192.168.1.100`). El celular y la PC deben estar en la misma red.
>
> Para obtener tu IP:
> - Windows: `ipconfig` → buscar "Dirección IPv4"
> - macOS/Linux: `ip addr` o `ifconfig`

---

## 3. Instalación de Dependencias

### Backend (Node.js — ejecutar en cada servicio)

```bash
cd Backend/api-gateway && npm install
cd Backend/auth-service && npm install
cd Backend/users-service && npm install
cd Backend/image-service && npm install
```

### ML Service (Python)

```bash
cd Backend/ml-service
pip install -r requirements.txt
```

> La primera instalación descarga PyTorch (~2GB). Tener paciencia.

---

## 4. Levantar los Servicios

Abrir **6 terminales separadas** y ejecutar en este orden:

### Terminal 1 — ML Service

```bash
cd Backend/ml-service
uvicorn main:app --host 0.0.0.0 --port 8000
```

Esperar hasta ver: `Application startup complete.`

### Terminal 2 — Users Service

```bash
cd Backend/users-service
npm run dev
```

Esperar: `Server running on port 3000`

### Terminal 3 — Auth Service

```bash
cd Backend/auth-service
npm run dev
```

Esperar: `Server running on port 3002`

### Terminal 4 — Image Service

```bash
cd Backend/image-service
npm run dev
```

Esperar: `Server running on port 5000`

### Terminal 5 — API Gateway

```bash
cd Backend/api-gateway
npm run dev
```

Esperar: `API Gateway running on port 4000`

### Terminal 6 — Frontend Expo

```bash
cd Frontend/smart-waste-mobile
npx expo start
```

Escanear el QR con la app **Expo Go** del celular.

---

## 5. Verificación Rápida del Backend

### Health check del API Gateway

```bash
curl http://localhost:4000/
```

Debe devolver la página de documentación (HTML).

### Login de prueba

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana.ciudadana@gmail.com","password":"Test1234!"}'
```

Respuesta esperada:
```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "user": { "id": "...", "email": "ana.ciudadana@gmail.com", "rol": "CIUDADANO" }
}
```

### Verificar ML Service

```bash
curl http://localhost:8000/
```

---

## 6. Flujos de Prueba Principales

### Flujo 1: Login y sesión (CIUDADANO)

1. Abrir Expo Go → escanear QR
2. Ir a pantalla de Login
3. Ingresar: `ana.ciudadana@gmail.com` / `Test1234!`
4. Debe redirigir al home de la app

### Flujo 2: Reporte de incidente (imagen + ML)

1. Loguearse como ciudadano (`ana.ciudadana@gmail.com`)
2. Navegar a "Reportar incidente"
3. Tomar o seleccionar una foto de basura acumulada
4. La app envía la imagen al image-service → ML service
5. Verificar que regresa tipo de residuo y nivel de acumulación

### Flujo 3: Recuperación de contraseña (OTP)

1. En la pantalla de Login → "¿Olvidaste tu contraseña?"
2. Ingresar email de un usuario de prueba
3. Revisar el correo (requiere SMTP configurado) o consultar la BD:
   ```sql
   SELECT * FROM auth.password_reset_tokens ORDER BY created_at DESC LIMIT 5;
   ```
4. Ingresar el OTP de 6 dígitos
5. Establecer nueva contraseña

### Flujo 4: Registro de nuevo ciudadano

1. En Login → "Crear cuenta"
2. Completar formulario (nombre, email, cédula)
3. Verificar OTP recibido por email
4. Establecer contraseña

### Flujo 5: Administración (ADMIN)

```bash
# Listar usuarios (requiere token de admin)
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@emaseo.gob.ec","password":"Test1234!"}' | python -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

curl http://localhost:4000/api/users \
  -H "Authorization: Bearer $TOKEN"
```

---

## 7. Puertos de Referencia

| Servicio | Puerto | URL |
|---|---|---|
| API Gateway | 4000 | http://localhost:4000 |
| Users Service | 3000 | http://localhost:3000 |
| Auth Service | 3002 | http://localhost:3002 |
| Image Service | 5000 | http://localhost:5000 |
| ML Service | 8000 | http://localhost:8000 |
| PostgreSQL | 5432 | localhost:5432 |

---

## 8. Problemas Comunes

### Error: `ECONNREFUSED` en el API Gateway
Algún microservicio no está corriendo. Verificar que todos los terminales
de los pasos 1–5 estén activos y sin errores.

### Error de conexión a la BD (`FATAL: password authentication failed`)
Revisar `DB_PASSWORD` en el `.env` del servicio correspondiente.

### El celular no conecta al backend
- Verificar que el celular y la PC estén en la misma red Wi-Fi
- Revisar que `EXPO_PUBLIC_API_URL` tenga la IP correcta (no `localhost`)
- Deshabilitar temporalmente el firewall de Windows para pruebas

### ML Service tarda mucho en responder
Normal en la primera petición (carga el modelo RTDETR en memoria). Las
siguientes peticiones serán más rápidas.

### `PostGIS extension not found`
Instalar PostGIS desde el Stack Builder de PostgreSQL y ejecutar:
```sql
-- En la base de datos MIC-EMASEO:
CREATE EXTENSION postgis;
CREATE EXTENSION "uuid-ossp";
CREATE EXTENSION pgcrypto;
```
