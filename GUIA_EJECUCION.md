# Guía de Ejecución — MIC EMASEO

> Manual completo para clonar, configurar y poner en marcha el sistema desde cero.  
> **Todo corre en Docker.** No necesitas instalar Node.js ni Python para ejecutar el sistema completo.

---

## Índice

1. [Requisitos del sistema](#1-requisitos-del-sistema)
2. [Clonar el repositorio](#2-clonar-el-repositorio)
3. [Configuración inicial](#3-configuración-inicial)
4. [Levantar el sistema](#4-levantar-el-sistema)
5. [Verificación — todo está corriendo](#5-verificación--todo-está-corriendo)
6. [Primeros pasos — probar la API](#6-primeros-pasos--probar-la-api)
7. [Desarrollo frontend (opcional)](#7-desarrollo-frontend-opcional)
8. [Operación diaria](#8-operación-diaria)
9. [Detener el sistema](#9-detener-el-sistema)
10. [Solución de problemas](#10-solución-de-problemas)
11. [Nota de producción](#11-nota-de-producción)

---

## 1. Requisitos del sistema

| Herramienta | Versión mínima | Verificar |
|------------|---------------|-----------|
| Docker Engine | 24+ | `docker --version` |
| Docker Compose | 2.20+ (plugin) | `docker compose version` |
| Git | cualquiera | `git --version` |
| bash / WSL | (para `start.sh`) | Solo en Windows sin WSL |
| openssl | cualquiera | `openssl version` |

**Hardware recomendado:**

- RAM: 8 GB mínimo (el ML worker carga el modelo RT-DETR-L de 63 MB en memoria).
- Disco: 5 GB libres (imágenes Docker + volúmenes de datos).
- CPU: cualquier x86-64 moderno. El modelo ML corre en CPU si no hay GPU NVIDIA.

**Solo para desarrollo frontend (no requerido para la API):**

- Node.js 18+ y npm (panel web y app móvil)
- Expo Go en tu móvil (Android o iOS)

---

## 2. Clonar el repositorio

```bash
git clone https://github.com/jsmena5/MIC-EMASEO-SISTEMA.git
cd MIC-EMASEO-SISTEMA
```

---

## 3. Configuración inicial

El sistema necesita un único archivo `.env` en la raíz del proyecto con todos los secretos.  
Hay **dos formas** de crearlo:

### Opción A — Script automático (recomendado)

El script `scripts/generate_env.sh` genera secretos criptográficamente seguros con `openssl rand`:

```bash
bash scripts/generate_env.sh
```

Salida esperada:

```
Generando secretos seguros...
✓ .env creado en: /ruta/al/proyecto/.env

Pendiente de completar manualmente:
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
```

> **Importante:** Completa las variables SMTP en el `.env` generado si quieres que funcionen los correos de OTP/recuperación de contraseña. Si no tienes SMTP, el sistema funciona pero los emails no se entregarán.

### Opción B — Manual

```bash
cp .env.example .env
```

Abre `.env` y reemplaza cada `<generar con: openssl rand -base64 N>` con un secreto real:

```bash
# Genera contraseñas de 32 caracteres
openssl rand -base64 24

# Genera el JWT_SECRET (64 caracteres)
openssl rand -base64 48

# Genera el INTERNAL_TOKEN (43 caracteres)
openssl rand -base64 32
```

### Variables que debes completar manualmente (en cualquier opción)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `SMTP_HOST` | Servidor SMTP para OTPs | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto SMTP | `587` |
| `SMTP_USER` | Correo remitente | `notificaciones@emaseo.ec` |
| `SMTP_PASS` | Contraseña del buzón SMTP | App password de Gmail |
| `EMAIL_FROM` | Nombre visible en los emails | `EMASEO EP <notif@emaseo.ec>` |
| `S3_PUBLIC_URL` | URL pública de MinIO para la app móvil | `http://192.168.1.X:9000` (\*) |

> (\*) **Crítico para móvil:** si el celular va a ver imágenes de MinIO, `S3_PUBLIC_URL` debe ser la IP local de tu red (no `localhost`). Encuentra tu IP con:
> ```powershell
> # Windows PowerShell
> (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' }).IPAddress
> ```
> ```bash
> # Linux / macOS / WSL
> ip route get 1 | awk '{print $7}' || hostname -I | awk '{print $1}'
> ```

### Habilitar puertos de administración (opcional)

Para acceder a la consola de MinIO, Redis y Flower desde el host, añade esto al `.env`:

```env
EXPOSE_DEV_PORTS=true
```

Con `EXPOSE_DEV_PORTS` vacío o sin definir, esos servicios solo son accesibles dentro de la red Docker (comportamiento de producción).

### Modo dummy del ML (para demo sin modelo)

Si no tienes el archivo `ML/modelos/rtdetr_l_best.pt`, activa el modo simulado:

```env
DUMMY_MODE=true
```

En este modo el endpoint `/predict` devuelve siempre `has_waste: true` con datos ficticios. **Para inferencia real**, establece `DUMMY_MODE=false` y coloca el modelo en `ML/modelos/rtdetr_l_best.pt`.

---

## 4. Levantar el sistema

### Opción A — Script automático `start.sh` (recomendado)

```bash
bash start.sh
```

El script:
1. Verifica que Docker esté disponible.
2. Si no existe `.env`, lo genera automáticamente.
3. Construye todas las imágenes Docker.
4. Levanta los 11 contenedores.
5. Espera a que todos los servicios reporten `healthy`.
6. Muestra las URLs de acceso.

Flags disponibles:

```bash
bash start.sh --build     # fuerza reconstrucción de imágenes (cuando cambias Dockerfile)
bash start.sh --no-build  # salta la construcción (cuando las imágenes ya existen)
bash start.sh --dev       # activa EXPOSE_DEV_PORTS automáticamente
```

### Opción B — Manual

```bash
# Primera vez (construye imágenes + levanta contenedores)
docker compose up -d --build

# Sesiones posteriores (sin reconstruir si no hubo cambios)
docker compose up -d
```

### ¿Cuánto tarda?

| Acción | Tiempo estimado |
|--------|----------------|
| Primera construcción (descarga de imágenes + build) | 5–15 min |
| PostgreSQL inicializando el schema | 30–60 s |
| ML API cargando el modelo RT-DETR-L | 30–90 s |
| Sesiones posteriores (imágenes ya construidas) | 15–30 s |

---

## 5. Verificación — todo está corriendo

```bash
docker compose ps
```

Estado esperado de cada contenedor:

| Contenedor | Estado esperado |
|-----------|----------------|
| `emaseo-postgres` | `healthy` |
| `emaseo-minio` | `healthy` |
| `emaseo-minio-init` | `exited (0)` — normal, ya creó el bucket |
| `emaseo-redis` | `healthy` |
| `emaseo-auth` | `healthy` |
| `emaseo-users` | `healthy` |
| `emaseo-image` | `healthy` |
| `emaseo-gateway` | `healthy` |
| `emaseo-ml-api` | `healthy` (puede tardar ~60 s la primera vez) |
| `emaseo-*-ml-worker-1` | `running` |
| `emaseo-flower` | `running` |

### Verificar el Gateway

```bash
curl http://localhost:4000/health
# Respuesta esperada: {"status":"ok"}
```

### Verificar el ML Service

```bash
# Solo si EXPOSE_DEV_PORTS=true (o desde dentro de Docker)
curl http://localhost:8000/health
# Respuesta en modo real:  {"status":"ok","mode":"rtdetr_l_best.pt"}
# Respuesta en modo dummy: {"status":"ok","mode":"dummy"}
```

### Verificar los schemas de la base de datos

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO -c "\dn"
```

Debes ver los schemas: `ai`, `audit`, `auth`, `incidents`, `notifications`, `operations`, `public`.

### URLs de acceso

| Servicio | URL | Credenciales |
|---------|-----|-------------|
| **API Gateway** | `http://localhost:4000` | — |
| **Swagger UI** | `http://localhost:4000/api-docs` | — |
| **MinIO Console** | `http://localhost:9001` (\*) | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` del `.env` |
| **Flower** | `http://localhost:5555` (\*) | `FLOWER_USER` / `FLOWER_PASSWORD` del `.env` |
| **ML Swagger** | `http://localhost:8000/docs` (\*) | — |

> (\*) Solo disponible con `EXPOSE_DEV_PORTS=true`.

---

## 6. Primeros pasos — probar la API

### Registrar un ciudadano (3 pasos)

**Paso 1 — Enviar datos y recibir OTP por email:**

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "ciudadano@ejemplo.com",
    "nombre": "Juan",
    "apellido": "Pérez",
    "cedula": "1720000000",
    "telefono": "0991234567"
  }'
# Respuesta: {"message":"OTP enviado al correo"}
```

**Paso 2 — Verificar OTP:**

```bash
curl -X POST http://localhost:4000/api/auth/verify-email \
  -H "Content-Type: application/json" \
  -d '{"email": "ciudadano@ejemplo.com", "otp": "123456"}'
# Respuesta: {"message":"Email verificado correctamente"}
```

**Paso 3 — Establecer contraseña:**

```bash
curl -X POST http://localhost:4000/api/users/set-password \
  -H "Content-Type: application/json" \
  -d '{"email": "ciudadano@ejemplo.com", "password": "MiContrasena123!"}'
# Respuesta: {"access_token":"...", "refresh_token":"..."}
```

### Login

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "ciudadano@ejemplo.com", "password": "MiContrasena123!"}'

# Guarda el access_token para las siguientes peticiones
export TOKEN="eyJ..."
```

### Simular un reporte de imagen

```bash
# Convierte una imagen a base64
IMAGE_B64=$(base64 -w 0 /ruta/a/imagen.jpg)

curl -X POST http://localhost:4000/api/image/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"image_base64\": \"$IMAGE_B64\",
    \"latitude\": -0.22985,
    \"longitude\": -78.52495
  }"

# Respuesta 202:
# {"task_id":"abc123","poll_url":"/api/image/status/abc123","message":"Análisis en proceso"}
```

### Consultar el estado del análisis (polling)

```bash
curl http://localhost:4000/api/image/status/abc123 \
  -H "Authorization: Bearer $TOKEN"

# 202 PROCESANDO → sigue esperando
# 200 PENDIENTE  → análisis exitoso (incluye nivel, volumen, tipo, url_imagen)
# 200 FALLIDO    → no se detectaron residuos o error del modelo
```

### Ver el historial de reportes del ciudadano

```bash
curl http://localhost:4000/api/incidents \
  -H "Authorization: Bearer $TOKEN"
```

### Usuarios de prueba (seed)

Si los datos iniciales de `Backend/database/02_seed_data.sql` incluyen usuarios de prueba, encuéntralos ahí. Por ejemplo:

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO \
  -c "SELECT email, rol FROM auth.users LIMIT 10;"
```

---

## 7. Desarrollo frontend (opcional)

Esta sección es para desarrolladores que quieren modificar el frontend. **No es necesaria para evaluar la API.**

### Panel de Supervisor (React + Vite)

```bash
cd Frontend/supervisor-panel
npm install

# Configurar la URL del Gateway
echo "VITE_API_URL=http://localhost:4000/api" > .env

npm run dev
# Abre http://localhost:5173
```

### App Móvil (Expo)

```bash
cd Frontend/smart-waste-mobile
npm install
```

Crea el archivo de configuración:

```bash
# Frontend/smart-waste-mobile/.env.development
EXPO_PUBLIC_API_URL=http://192.168.1.X:4000/api
```

> Reemplaza `192.168.1.X` con tu IP local (la misma que usaste en `S3_PUBLIC_URL`).

Iniciar Expo:

```bash
# Opción A — Red local (recomendado para desarrollo)
npx expo start
# Escanea el QR con Expo Go desde el celular

# Opción B — Limpiar caché (cuando el bundle parece obsoleto)
npx expo start -c

# Opción C — Túnel público (para demo remota o evaluación sin LAN compartida)
# Paso 1: exponer el Gateway
cloudflared tunnel --url http://localhost:4000
# Paso 2: actualizar EXPO_PUBLIC_API_URL con la URL del túnel
# Paso 3:
npx expo start --tunnel
```

> **Nota:** Cada vez que `cloudflared` reinicia, genera una URL nueva. Actualiza `.env.development` y reinicia Expo.

---

## 8. Operación diaria

### Levantar (sin reconstruir)

```bash
docker compose up -d
```

### Ver estado

```bash
docker compose ps
```

### Ver logs en tiempo real

```bash
docker compose logs -f api-gateway
docker compose logs -f image-service
docker compose logs -f ml-api
docker compose logs -f ml-worker
docker compose logs -f postgres
```

### Conectarse a la base de datos

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO
```

### Escalar ML Workers (pruebas de carga)

```bash
docker compose up -d --scale ml-worker=3
```

### Ver tareas Celery en Flower

Abre `http://localhost:5555` (requiere `EXPOSE_DEV_PORTS=true`).  
Credenciales: `FLOWER_USER` / `FLOWER_PASSWORD` del `.env`.

### Reconstruir solo un servicio

```bash
# Reconstruir y reiniciar solo el image-service
docker compose up -d --build image-service
```

---

## 9. Detener el sistema

### Parar contenedores (conserva los datos)

```bash
docker compose down
```

Los volúmenes `postgres_data`, `minio_data`, `redis_data` se conservan. La próxima vez que levantes, los datos estarán intactos.

### Reset completo (borra todos los datos)

```bash
# ⚠ IRREVERSIBLE — borra BD, imágenes y tareas pendientes
docker compose down -v
```

Úsalo solo para empezar desde cero (p. ej. para probar la inicialización del schema).

---

## 10. Solución de problemas

### El contenedor no arranca o se reinicia

```bash
docker compose logs <nombre-del-servicio>
# Ejemplos:
docker compose logs postgres
docker compose logs auth-service
docker compose logs ml-api
```

### `emaseo-ml-api` sigue en `starting` después de 2 minutos

El ML API tiene un `start_period` de 30 s. Si tarda más, verifica:

```bash
docker compose logs ml-api
```

Causas comunes:
- `DUMMY_MODE=false` y el archivo `ML/modelos/rtdetr_l_best.pt` no existe → pon `DUMMY_MODE=true` o proporciona el modelo.
- RAM insuficiente → el modelo necesita ~1 GB de RAM libre.

### Puerto 4000 ocupado

```bash
# Windows PowerShell
netstat -ano | findstr :4000

# Linux / macOS
lsof -i :4000
```

Termina el proceso que ocupa el puerto o cambia el puerto del Gateway en `docker-compose.yml`.

### Error de autenticación en PostgreSQL al reiniciar

Si cambiaste `POSTGRES_PASSWORD` en el `.env` pero el volumen `postgres_data` ya tiene la contraseña anterior:

```bash
# Borra el volumen para aplicar la nueva contraseña
docker compose down -v
docker compose up -d --build
```

### Los correos de OTP no llegan

1. Verifica que `SMTP_*` estén correctamente configurados en `.env`.
2. Si usas Gmail, genera una **contraseña de aplicación** (no la contraseña normal):
   - [myaccount.google.com](https://myaccount.google.com) → Seguridad → Verificación en 2 pasos → Contraseñas de aplicación.
3. Prueba la conexión SMTP:
   ```bash
   docker compose logs auth-service | grep -i smtp
   ```

### `EXPOSE_DEV_PORTS=false` no desactiva los puertos

`false` es una cadena **no vacía**, por lo que sí publica los puertos. Para desactivarlos, deja la variable **vacía**:

```env
EXPOSE_DEV_PORTS=
```

### La app móvil no carga imágenes

`S3_PUBLIC_URL` debe ser la IP de tu red local, no `localhost`. El celular no puede resolver `localhost` del servidor.

```env
# ✗ Incorrecto
S3_PUBLIC_URL=http://localhost:9000

# ✓ Correcto (usa tu IP local)
S3_PUBLIC_URL=http://192.168.1.42:9000
```

Además asegúrate de tener `EXPOSE_DEV_PORTS=true` para que MinIO sea accesible desde el celular.

### Circuit Breaker abierto — ML Service degradado

Si ves el mensaje `"El servicio de análisis visual está temporalmente degradado"`:

```bash
docker compose logs ml-api --tail=50
docker compose logs ml-worker --tail=50
```

El circuit breaker se cierra automáticamente después de 30 s si el ML Service se recupera. Puedes reiniciarlo manualmente:

```bash
docker compose restart ml-api ml-worker
```

---

## 11. Nota de producción

Para despliegue en producción, revisa y ajusta las siguientes variables en `.env`:

| Variable | Valor desarrollo | Valor producción recomendado |
|----------|-----------------|------------------------------|
| `EXPOSE_DEV_PORTS` | `true` | `` (vacío — nunca exponer MinIO/Redis/Flower) |
| `DUMMY_MODE` | `true` (sin modelo) | `false` (con `rtdetr_l_best.pt`) |
| `S3_PUBLIC_URL` | `http://localhost:9000` | URL pública con TLS (ej. `https://storage.emaseo.ec`) |
| `CORS_ORIGINS` | `http://localhost:5173` | Dominio real del panel web |
| `SMTP_*` | Servidor de prueba | Servidor SMTP de producción |
| Puertos Flower/MinIO | Expuestos | Detrás de proxy TLS o solo VPN |

Además:
- Configura un **proxy inverso** (Nginx, Caddy, Traefik) con TLS delante del puerto 4000.
- Habilita copias de seguridad automáticas del volumen `postgres_data`.
- Considera **GPU NVIDIA** para el ML worker: descomenta el bloque `reservations` en `docker-compose.yml` y asegúrate de tener el [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).
- En el `.env` asegúrate de que todos los secretos sean únicos y de alta entropía (`openssl rand -base64 48`).

---

## Referencia rápida — Comandos esenciales

```bash
# Levantar todo (primera vez con build)
docker compose up -d --build

# Levantar (sesiones posteriores)
docker compose up -d

# Ver estado
docker compose ps

# Ver logs de un servicio
docker compose logs -f api-gateway

# Conectar a la BD
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO

# Escalar ML workers
docker compose up -d --scale ml-worker=3

# Apagar (conserva datos)
docker compose down

# Reset total (borra datos)
docker compose down -v

# Ver qué proceso usa un puerto (Windows)
netstat -ano | findstr :4000
```
