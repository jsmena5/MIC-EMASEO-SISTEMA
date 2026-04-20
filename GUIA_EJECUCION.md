# Guía de Ejecución — MIC-EMASEO Sistema

---

## Sección 0: Glosario y Arquitectura (El "Por qué")

Antes de ejecutar cualquier comando, entender el propósito de cada pieza evita
confusiones y errores difíciles de diagnosticar.

### ¿Por qué Docker en lugar de instalar PostgreSQL directo en Windows?

PostgreSQL con la extensión **PostGIS** (necesaria para coordenadas GPS) requiere
compiladores nativos y librerías C que son difíciles de instalar en Windows sin
conflictos de versión. Docker encapsula esa complejidad en una imagen preconstruida:
el equipo garantiza que todos los desarrolladores corren exactamente el mismo motor
de base de datos, con la misma versión de PostGIS, sin importar el sistema operativo
del host.

### ¿Por qué MinIO y no AWS S3 directamente?

El image-service sube fotos de incidentes a un **object storage compatible con S3**.
En producción eso será AWS S3; en local usamos **MinIO**, que expone exactamente la
misma API de S3 pero corre dentro de Docker. Esto significa que el código del
image-service no cambia entre entornos: solo cambia la variable `S3_ENDPOINT` en el
`.env`.

### El patrón de los 3 contenedores Docker

`docker-compose.yml` levanta tres contenedores relacionados con almacenamiento:

| Contenedor | Tipo | Propósito |
|---|---|---|
| `emaseo-postgres` | **Permanente** | Motor PostgreSQL 16 + PostGIS. Debe estar siempre corriendo mientras se desarrolla. |
| `emaseo-minio` | **Permanente** | Servidor MinIO. Debe estar siempre corriendo mientras se desarrolla. |
| `emaseo-minio-init` | **Efímero (diseño)** | Crea el bucket `emaseo-incidents` y lo marca como público. Se apaga solo al terminar. Es normal verlo en estado `Exited (0)`. |

> `Exited (0)` en `emaseo-minio-init` **no es un error**. Significa que completó su
> trabajo exitosamente. Solo los dos contenedores `emaseo-postgres` y `emaseo-minio`
> deben permanecer en estado `running`/`healthy`.

### Mapa de puertos

| Servicio | Puerto | URL local |
|---|---|---|
| API Gateway + Swagger UI | 4000 | http://localhost:4000 |
| Users Service | 3000 | http://localhost:3000 |
| Auth Service | 3002 | http://localhost:3002 |
| Image Service | 5000 | http://localhost:5000 |
| ML Service | 8000 | http://localhost:8000 |
| PostgreSQL (Docker) | 5432 | localhost:5432 |
| MinIO — S3 API (Docker) | 9000 | http://localhost:9000 |
| MinIO — Consola web (Docker) | 9001 | http://localhost:9001 |

---

## Fase 1: Instalación desde Cero (Solo el Día 1)

Estos pasos se ejecutan **una única vez** al incorporarse al proyecto.
Si ya tienes el entorno configurado, ve directamente a la **Fase 2**.

### 1.1 Prerrequisitos

Instalar y verificar:

| Herramienta | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 18+ | `node -v` |
| npm | 9+ | `npm -v` |
| Python | 3.10+ | `python --version` |
| Docker Desktop | última | `docker -v` |
| Expo Go | última | App Store / Play Store |

### 1.2 Clonar el repositorio y crear los `.env`

```bash
git clone <url-del-repositorio>
cd MIC-EMASEO-SISTEMA
```

Copiar cada `.env.example` y completar los valores marcados con `#`:

```bash
cp Backend/users-service/.env.example   Backend/users-service/.env
cp Backend/auth-service/.env.example    Backend/auth-service/.env
cp Backend/image-service/.env.example   Backend/image-service/.env
```

#### Backend/users-service/.env

```env
PORT=3000
JWT_SECRET=mic_emaseo_secret_2025
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=postgres
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=             # email Gmail para enviar OTPs de registro
SMTP_PASS=             # contraseña de aplicación Gmail (no la contraseña normal)
EMAIL_FROM=EMASEO EP <tu_email@gmail.com>
```

#### Backend/auth-service/.env

```env
PORT=3002
JWT_SECRET=mic_emaseo_secret_2025   # debe ser IGUAL al de users-service y api-gateway
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=postgres
DB_PORT=5432
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=             # email Gmail para enviar OTPs de recuperación de contraseña
SMTP_PASS=
EMAIL_FROM=EMASEO EP <tu_email@gmail.com>
```

#### Backend/image-service/.env

```env
PORT=5000
DB_USER=postgres
DB_HOST=localhost
DB_NAME=MIC-EMASEO
DB_PASSWORD=postgres
DB_PORT=5432
ML_SERVICE_URL=http://localhost:8000/predict

# Object Storage — MinIO local (para producción: eliminar S3_ENDPOINT y actualizar credenciales)
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=emaseo-incidents
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
S3_PUBLIC_URL=http://localhost:9000
```

#### Backend/api-gateway (ya incluye `.env`)

Verificar que `JWT_SECRET` coincida con los demás servicios:

```env
JWT_SECRET=mic_emaseo_secret_2025
```

#### Frontend/smart-waste-mobile/.env.development

```env
EXPO_PUBLIC_API_URL=http://<TU_IP_LOCAL>:4000/api
```

Reemplazar `<TU_IP_LOCAL>` con la IP de tu máquina en la red Wi-Fi
(el celular y la PC deben estar en la misma red):

```bash
# Windows
ipconfig   # buscar "Dirección IPv4"

# macOS / Linux
ip addr    # o ifconfig
```

### 1.3 Instalar dependencias

#### Node.js (los 4 servicios)

```bash
cd Backend/api-gateway  && npm install && cd ../..
cd Backend/auth-service && npm install && cd ../..
cd Backend/users-service && npm install && cd ../..
cd Backend/image-service && npm install && cd ../..
```

#### ML Service — entorno virtual Python

Es obligatorio usar `venv` para evitar conflictos de PATH en Windows.

```bash
cd Backend/ml-service

# 1. Crear el entorno virtual
python -m venv venv

# 2. Activar el entorno
#    Windows (PowerShell):
.\venv\Scripts\activate
#    macOS / Linux:
source venv/bin/activate

# 3. Instalar dependencias (el prompt debe mostrar "(venv)" antes de continuar)
pip install -r requirements.txt
```

> **Error de permisos en Windows (texto rojo al activar):** ejecutar primero
> en PowerShell como administrador:
> ```powershell
> Set-ExecutionPolicy Unrestricted -Scope CurrentUser
> ```
> La primera instalación descarga PyTorch (~2 GB). Tener paciencia.

### 1.4 Levantar Docker por primera vez

```bash
docker-compose up -d
```

En el primer arranque, Docker ejecuta automáticamente:
- `Backend/database/01_init_schema.sql` — esquemas, tablas, ENUMs, PostGIS, pgcrypto
- `Backend/database/02_seed_data.sql` — usuarios y datos de prueba

Verificar el estado de los contenedores:

```bash
docker-compose ps
```

Estado esperado:
- `emaseo-postgres` → `healthy`
- `emaseo-minio` → `healthy`
- `emaseo-minio-init` → `Exited (0)` ← normal, ver Sección 0

### 1.5 Aplicar migraciones adicionales (una sola vez)

Estas migraciones **no** están en docker-compose y deben ejecutarse manualmente:

```bash
psql -U postgres -h localhost -d "MIC-EMASEO" -f Backend/database/008_refresh_tokens.sql
psql -U postgres -h localhost -d "MIC-EMASEO" -f Backend/database/009_password_reset_tokens.sql
```

> Password del contenedor: **`postgres`** (definido en `docker-compose.yml`)

---

## Fase 2: Rutina Diaria (Cómo prender el sistema para programar)

Estos son los únicos pasos que se repiten cada día de trabajo.

### 2.1 Asegurar que Docker está corriendo

```bash
docker-compose up -d
```

Si ya estaba corriendo, el comando no hace nada dañino. Verificar:

```bash
docker-compose ps
```

`emaseo-postgres` y `emaseo-minio` deben estar en estado `healthy`.

### 2.2 Levantar los 4 servicios Node.js

Abrir 4 terminales y ejecutar uno por terminal:

```bash
# Terminal 1 — Users Service
cd Backend/users-service && npm run dev
# Listo cuando aparece: Server running on port 3000

# Terminal 2 — Auth Service
cd Backend/auth-service && npm run dev
# Listo cuando aparece: Server running on port 3002

# Terminal 3 — Image Service
cd Backend/image-service && npm run dev
# Listo cuando aparece: Server running on port 5000

# Terminal 4 — API Gateway
cd Backend/api-gateway && npm run dev
# Listo cuando aparece: API Gateway running on port 4000
```

### 2.3 Levantar el ML Service

```bash
# Terminal 5
cd Backend/ml-service

# Activar el entorno virtual (obligatorio cada sesión)
#   Windows:
.\venv\Scripts\activate
#   macOS/Linux:
source venv/bin/activate

# Iniciar el servidor
python -m uvicorn main:app --host 0.0.0.0 --port 8000
# Listo cuando aparece: Application startup complete.
```

> La primera petición del día tarda ~10–20 s mientras el modelo RT-DETR-L
> (~1–2 GB) se carga en memoria. Las siguientes son instantáneas.

### 2.4 Levantar el Frontend Expo

```bash
# Terminal 6
cd Frontend/smart-waste-mobile
npx expo start
```

Escanear el QR con la app **Expo Go** del celular.

### 2.5 Túneles para pruebas en dispositivo físico (opcional)

Si el celular no está en la misma red Wi-Fi que la PC, usar un túnel:

```bash
# Opción A — Cloudflare Quick Tunnel (sin cuenta)
cloudflared tunnel --url http://localhost:4000

# Opción B — ngrok
ngrok http 4000

# Opción C — localtunnel
lt --port 4000
```

Copiar la URL pública generada y actualizarla en
`Frontend/smart-waste-mobile/.env.development`:

```env
EXPO_PUBLIC_API_URL=https://<url-del-tunel>/api
```

Reiniciar Expo después de cambiar el `.env`.

---

## Apéndice A: Verificación Rápida del Backend

```bash
# Health check del API Gateway
curl http://localhost:4000/

# Login de prueba
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana.ciudadana@gmail.com","password":"Test1234!"}'
# Respuesta: {"token":"eyJ...","refreshToken":"a3f2..."}
# Nota: el campo es "token" (JWT 15 min), no "accessToken"

# Health check del ML Service
curl http://localhost:8000/health
# Respuesta: {"status":"ok","model":"rtdetr_l_best.pt",...}

# Health check de MinIO
curl http://localhost:9000/minio/health/live
# Respuesta: HTTP 200
```

Swagger UI completo: http://localhost:4000

---

## Apéndice B: Usuarios de Prueba (seed)

Password de todos: **`Test1234!`**

| Email | Rol |
|---|---|
| admin@emaseo.gob.ec | ADMIN |
| maria.lopez@emaseo.gob.ec | SUPERVISOR |
| pedro.garcia@emaseo.gob.ec | OPERARIO |
| luis.martinez@emaseo.gob.ec | OPERARIO |
| ana.ciudadana@gmail.com | CIUDADANO |
| jorge.ramirez@gmail.com | CIUDADANO |

Consola de MinIO → http://localhost:9001 (usuario: `minioadmin` / contraseña: `minioadmin`)

---

## Apéndice C: Flujos de Prueba Principales

### Flujo 1: Login (CIUDADANO)

1. Abrir Expo Go → escanear QR
2. Ir a pantalla de Login
3. Ingresar: `ana.ciudadana@gmail.com` / `Test1234!`

### Flujo 2: Reporte de incidente (imagen + ML + MinIO)

1. Loguearse como ciudadano
2. Navegar a "Reportar incidente" y tomar/seleccionar una foto
3. El image-service sube la imagen a MinIO, llama al ML service (RT-DETR-L)
   y crea el incidente en PostgreSQL con coordenadas PostGIS
4. La respuesta debe incluir `tipo_residuo`, `nivel_acumulacion`, `prioridad`,
   `volumen_estimado_m3` e `image_url`
5. Confirmar que la imagen aparece en la consola MinIO: http://localhost:9001

### Flujo 3: Recuperación de contraseña (OTP)

1. `POST /api/auth/forgot-password` — email → OTP al correo (TTL 15 min)
2. `POST /api/auth/verify-reset-otp` — validar OTP
3. `POST /api/auth/reset-password` — nueva contraseña + OTP → devuelve tokens

Sin SMTP configurado, leer el OTP desde los logs del auth-service en consola
(los imprime en modo dev).

### Flujo 4: Registro de nuevo ciudadano

1. `POST /api/users/register` — nombre, apellido, cédula, email → OTP (TTL 10 min)
2. `POST /api/users/verify-email` — email + OTP
3. `POST /api/users/set-password` — email + contraseña → JWT

### Flujo 5: Administración (ADMIN)

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@emaseo.gob.ec","password":"Test1234!"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl http://localhost:4000/api/users -H "Authorization: Bearer $TOKEN"
```

---

## Apéndice D: Problemas Comunes

### `ECONNREFUSED` en el API Gateway
Algún microservicio no está corriendo. Verificar que las 5 terminales (Node + Python)
estén activas y sin errores.

### `FATAL: password authentication failed`
El password por defecto del contenedor es `postgres`. Verificar `DB_PASSWORD=postgres`
en el `.env` de cada servicio.

### `NoSuchBucket` o `connect ECONNREFUSED 9000` en image-service
MinIO no está corriendo. Ejecutar `docker-compose up -d` y esperar que
`emaseo-minio` esté en estado `healthy`.

### Las imágenes se suben pero no son accesibles por URL
El bucket debe ser público. El contenedor `emaseo-minio-init` lo configura
automáticamente. Para repararlo manualmente:

```bash
docker run --rm --network host minio/mc:latest \
  sh -c "mc alias set local http://localhost:9000 minioadmin minioadmin && \
         mc anonymous set download local/emaseo-incidents"
```

### El celular no conecta al backend
- Verificar que el celular y la PC estén en la misma red Wi-Fi
- Revisar que `EXPO_PUBLIC_API_URL` tenga la IP correcta (no `localhost`)
- Deshabilitar temporalmente el firewall de Windows para pruebas

### Restablecer la infraestructura desde cero

```bash
# Detener, eliminar contenedores y volúmenes (borra todos los datos)
docker-compose down -v

# Volver a levantar (re-ejecuta las migraciones iniciales automáticamente)
docker-compose up -d
```

> Después de un reset, repetir el **paso 1.5** (migraciones adicionales).
