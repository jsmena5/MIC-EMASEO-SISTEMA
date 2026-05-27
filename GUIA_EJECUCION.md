# Guía de Ejecución — MIC EMASEO

> Manual completo para configurar, levantar y verificar el sistema desde cero.
> El backend corre **enteramente en Docker** con un solo comando.
> El panel web y la app móvil se levantan por separado como procesos de desarrollo.

> 🚀 **Despliegue en la nube**: ver [`deploy/README.md`](deploy/README.md) para
> instrucciones de VPS + Supabase + Cloudflare R2.

---

## ⚡ Arranque rápido (sesión diaria)

> Ya configuraste el sistema antes. Solo quieres volver a levantar todo.

### Terminal 1 — Backend Docker
```powershell
.\start.ps1 -NoBuild
```

### Terminal 2 — Panel de supervisor
```bash
cd Frontend/supervisor-panel
npm run dev
# → http://localhost:5173
```

### Terminal 3 — App móvil con túnel (celular en cualquier red)
```powershell
.\start-remote.ps1
```
> Este script hace **todo automáticamente**: genera un túnel Cloudflare nuevo, actualiza `Frontend/smart-waste-mobile/.env.development` con la URL fresca y abre Expo en una nueva ventana. Solo escanea el QR con Expo Go.

### App móvil sin túnel (celular en la misma WiFi que el servidor)
```bash
cd Frontend/smart-waste-mobile
npx expo start -c
# Asegúrate de tener en .env.development:
# EXPO_PUBLIC_API_URL=http://<IP-de-tu-máquina>:4000/api
```

---

## Índice

1. [Requisitos del sistema](#1-requisitos-del-sistema)
2. [Clonar el repositorio](#2-clonar-el-repositorio)
3. [Configuración inicial (.env)](#3-configuración-inicial-env)
4. [Levantar el backend (Docker)](#4-levantar-el-backend-docker)
5. [Panel de Supervisor (React + Vite)](#5-panel-de-supervisor-react--vite)
6. [App Móvil (Expo)](#6-app-móvil-expo)
7. [Túnel Cloudflare (acceso remoto)](#7-túnel-cloudflare-acceso-remoto)
8. [Verificación — todo está corriendo](#8-verificación--todo-está-corriendo)
9. [Operación diaria](#9-operación-diaria)
10. [Correr tests del ML](#10-correr-tests-del-ml)
11. [Detener el sistema](#11-detener-el-sistema)
12. [Solución de problemas](#12-solución-de-problemas)
13. [Nota de producción](#13-nota-de-producción)
14. [Referencia rápida de comandos](#14-referencia-rápida-de-comandos)

---

## 1. Requisitos del sistema

### Backend (obligatorio)

| Herramienta | Versión mínima | Verificar |
|------------|----------------|-----------|
| Docker Desktop | 24+ | `docker --version` |
| Docker Compose | 2.20+ (plugin) | `docker compose version` |
| Git | cualquiera | `git --version` |

**Hardware mínimo:**
- RAM: 8 GB (el ML Worker carga el modelo RT-DETR-L en memoria)
- Disco: 5 GB libres (imágenes Docker + volúmenes de datos)
- CPU: cualquier x86-64 moderno. Funciona en CPU si no hay GPU NVIDIA.

### Panel web (opcional, para desarrollo)

| Herramienta | Versión mínima |
|------------|----------------|
| Node.js | 18+ |
| npm | incluido con Node.js |

### App móvil (opcional)

| Herramienta | Versión mínima |
|------------|----------------|
| Node.js | 18+ |
| Expo Go | última versión (Android o iOS) |

### Túnel Cloudflare (opcional, para acceso remoto)

| Herramienta | Instalar |
|------------|----------|
| cloudflared | `winget install --id Cloudflare.cloudflared` (Windows) |

---

## 2. Clonar el repositorio

```bash
git clone https://github.com/jsmena5/MIC-EMASEO-SISTEMA.git
cd MIC-EMASEO-SISTEMA
```

> **Nota Windows — rutas con espacios:** si el repositorio está en `C:\REPOSITORIOS GITHUB\...`, Docker Compose puede fallar al leer volúmenes. El script `start.ps1` lo resuelve automáticamente con una directory junction sin espacios. Si usas comandos manuales, crea la junction primero:
> ```powershell
> cmd /c mklink /J C:\MIC-EMASEO-WORK "C:\REPOSITORIOS GITHUB\MIC-EMASEO-SISTEMA"
> cd C:\MIC-EMASEO-WORK
> ```

---

## 3. Configuración inicial (.env)

El sistema necesita un archivo `.env` en la raíz del proyecto con todos los secretos.

### Opción A — Script automático (recomendado)

```powershell
# Windows
.\start.ps1
# Genera .env automáticamente si no existe, luego construye y levanta todo.
```

```bash
# Linux / macOS / WSL
bash start.sh
```

```bash
# Solo generar el .env (sin levantar servicios)
bash scripts/generate_env.sh
```

### Opción B — Manual

```bash
cp .env.example .env
# Edita .env y reemplaza los placeholders con secretos reales:
openssl rand -base64 24   # contraseñas de BD, MinIO, Redis
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # INTERNAL_TOKEN
```

### Variables que debes completar manualmente

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `SMTP_HOST` | Servidor SMTP para emails | `smtp.gmail.com` |
| `SMTP_PORT` | Puerto SMTP | `587` |
| `SMTP_USER` | Correo remitente | `notif@emaseo.ec` |
| `SMTP_PASS` | Contraseña SMTP | Ver nota Gmail ↓ |
| `EMAIL_FROM` | Dirección visible | `EMASEO EP <notif@emaseo.ec>` |
| `S3_PUBLIC_URL` | URL pública para imágenes | `http://localhost:4000/api/media` |

> **`S3_PUBLIC_URL` — importante:**
> - Para desarrollo local (panel web en `localhost`): `http://localhost:4000/api/media`
> - Para acceso desde celular / LAN: `http://192.168.X.X:4000/api/media` (IP de tu máquina, puerto 4000 del gateway)
> - **Ya no apunta al puerto 9000 de MinIO** — las imágenes se sirven a través del API Gateway, que hace proxy interno hacia MinIO sin exponer ese puerto.
>
> Para encontrar tu IP local:
> ```powershell
> # Windows
> (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' }).IPAddress
> ```
> ```bash
> # Linux / macOS / WSL
> hostname -I | awk '{print $1}'
> ```

> **Gmail App Password:** usa una contraseña de aplicación, no la contraseña de tu cuenta.
> 1. [myaccount.google.com](https://myaccount.google.com) → Seguridad → Verificación en 2 pasos
> 2. **Contraseñas de aplicaciones** → Generar → nombre: `EMASEO`
> 3. Copia la clave de 16 caracteres en `SMTP_PASS` del `.env` (sin espacios)

---

## 4. Levantar el backend (Docker)

> **11 contenedores, un solo comando.** No necesitas instalar Node.js ni Python.

### Windows (PowerShell)

```powershell
# Primera vez — genera .env + construye imágenes + levanta todo
.\start.ps1

# Después de cambios en el código — reconstruye solo lo modificado
.\start.ps1 -Build

# Inicio rápido — sin reconstruir (imágenes ya existen)
.\start.ps1 -NoBuild

# Con puertos de administración: MinIO :9001, Redis :6379, Flower :5555
.\start.ps1 -Dev

# Backend + túnel Cloudflare automático
.\start.ps1 -Tunnel

# Backend + abrir Expo en nueva ventana
.\start.ps1 -Expo

# Combinaciones frecuentes
.\start.ps1 -NoBuild -Dev
.\start.ps1 -Tunnel -Expo
```

### Linux / macOS / WSL

```bash
bash start.sh          # primera vez
bash start.sh --build  # forzar reconstrucción
bash start.sh --no-build  # inicio rápido
bash start.sh --dev    # con puertos de administración
```

### Manual (cualquier plataforma)

```bash
# Primera vez
docker compose up -d --build

# Sesiones posteriores
docker compose up -d

# Con puertos de administración
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

### Contenedores del sistema

| Contenedor | Función | Puerto host |
|-----------|---------|-------------|
| `emaseo-postgres` | PostgreSQL 16 + PostGIS 3.4 | 5432 |
| `emaseo-minio` | Object Storage (imágenes) | — (\*) |
| `emaseo-redis` | Broker de tareas Celery | — (\*) |
| `emaseo-auth` | Autenticación, OTP, emails | — |
| `emaseo-users` | Gestión de perfiles | — |
| `emaseo-image` | Orquestador de reportes + Circuit Breaker | — |
| `emaseo-gateway` | **API Gateway** — único punto de entrada externo | **4000** |
| `emaseo-ml-api` | FastAPI ML (Gunicorn + Uvicorn) | — |
| `emaseo-ml-worker-1` | Celery Worker — inferencia RT-DETR | — |
| `emaseo-flower` | Dashboard Celery | — (\*) |
| `emaseo-minio-init` | Crea el bucket (se detiene solo) | — |

> (\*) Solo publicados en `127.0.0.1` cuando activas `-Dev` o `docker-compose.dev.yml`.
> Las imágenes almacenadas en MinIO son accesibles para el navegador a través del gateway en `/api/media/*` (puerto 4000) — **no necesitas exponer el puerto 9000**.

### Tiempos de arranque

| Acción | Tiempo estimado |
|--------|----------------|
| Primera construcción | 5–15 min |
| PostgreSQL inicializando schema | 30–60 s |
| ML API cargando modelo RT-DETR-L | 30–90 s |
| Arranque normal (sin reconstruir) | 15–30 s |

---

## 5. Panel de Supervisor (React + Vite)

> El panel web **no corre en Docker** — se levanta con Vite en modo desarrollo.

### Instalación (solo la primera vez)

```bash
cd Frontend/supervisor-panel
npm install
```

### Configurar la URL del API

El archivo `Frontend/supervisor-panel/.env` ya existe en el repositorio:

```env
VITE_API_URL=http://localhost:4000/api
```

Si usas túnel Cloudflare, edítalo con la URL del túnel:
```env
VITE_API_URL=https://tu-url.trycloudflare.com/api
```

### Ejecutar

```bash
cd Frontend/supervisor-panel
npm run dev
# → Abre http://localhost:5173
```

### Usuarios de prueba

| Email | Contraseña | Rol |
|-------|-----------|-----|
| `maria.lopez@emaseo.gob.ec` | `Test1234!` | SUPERVISOR |
| `admin@emaseo.gob.ec` | `Test1234!` | ADMIN |

---

## 6. App Móvil (Expo)

> Usa Expo SDK 54 + Expo Go en el celular.

### Instalación (solo la primera vez)

```bash
cd Frontend/smart-waste-mobile
npm install
```

### Configurar la URL del API

Crea o edita `Frontend/smart-waste-mobile/.env.development`:

```env
# Red local (celular en la misma WiFi que el servidor)
EXPO_PUBLIC_API_URL=http://192.168.X.X:4000/api

# Acceso remoto (datos móviles, túnel Cloudflare) — ver sección 7
# EXPO_PUBLIC_API_URL=https://tu-url.trycloudflare.com/api
```

> Reemplaza `192.168.X.X` con la IP local de tu máquina. El puerto **4000** (gateway) ya está expuesto en todas las interfaces — no necesitas nada más.

### Ejecutar — red local (misma WiFi)

```bash
cd Frontend/smart-waste-mobile
npx expo start
```

Escanea el QR con **Expo Go**. El celular y la computadora deben estar en la **misma red WiFi**.

```bash
# Limpiar caché (cuando el bundle parece desactualizado)
npx expo start -c
```

### Para acceso remoto → ver sección 7 ↓

---

## 7. Túnel Cloudflare (acceso remoto)

> Sin túnel, Expo Go solo funciona en la misma red WiFi.  
> El túnel expone el API Gateway y el Metro Bundler a internet para conectarte desde datos móviles o cualquier red.  
> **No requiere cuenta en Cloudflare.**

### Instalar cloudflared

```powershell
# Windows
winget install --id Cloudflare.cloudflared
```
```bash
# macOS
brew install cloudflared

# Linux
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared && sudo mv cloudflared /usr/local/bin/
```

Verificar: `cloudflared --version`

---

### Opción A — Modo remoto completo (Windows) ✅ Recomendado

Levanta dos túneles en paralelo (API + Metro Bundler), actualiza `.env.development` automáticamente y abre Expo.

```powershell
# Paso 1 — backend corriendo
.\start.ps1 -NoBuild

# Paso 2 — modo remoto completo
.\start-remote.ps1
```

Escanea el QR que aparece con Expo Go. Funciona desde cualquier red.

> Presiona **Ctrl+C** en la ventana de `start-remote.ps1` para detener ambos túneles.

---

### Opción B — Solo túnel API (integrado en start.ps1)

```powershell
.\start.ps1 -Tunnel
```

Luego en otra terminal:
```bash
cd Frontend/smart-waste-mobile
npx expo start --tunnel -c
```

---

### Opción C — Solo túnel API (Linux / macOS / WSL)

```bash
# Terminal 1
bash tools/start-tunnel.sh

# Terminal 2
cd Frontend/smart-waste-mobile
npx expo start --tunnel -c
```

---

### Opción D — Manual

```bash
# Terminal 1 — espera ~15 s hasta ver la URL pública
cloudflared tunnel --url http://localhost:4000
# "Your quick Tunnel has been created! Visit it at: https://xxx.trycloudflare.com"
```

Edita `Frontend/smart-waste-mobile/.env.development`:
```env
EXPO_PUBLIC_API_URL=https://xxx.trycloudflare.com/api
```

```bash
# Terminal 2
cd Frontend/smart-waste-mobile
npx expo start --tunnel -c
```

> ⚠ Cada vez que `cloudflared` se reinicia genera una **URL diferente**. Siempre actualiza `.env.development` y reinicia Expo con `-c`.

---

### Resumen de escenarios

| Escenario | Comando |
|-----------|---------|
| Solo backend | `.\start.ps1` / `bash start.sh` |
| Backend + túnel API (Windows) | `.\start.ps1 -Tunnel` |
| Backend + túnel completo (Windows) | `.\start-remote.ps1` |
| Solo túnel API (Linux/WSL) | `bash tools/start-tunnel.sh` |
| Panel supervisor | `cd Frontend/supervisor-panel && npm run dev` |
| App móvil — red local | `cd Frontend/smart-waste-mobile && npx expo start` |
| App móvil — remoto | `npx expo start --tunnel -c` |

---

## 8. Verificación — todo está corriendo

### Estado de contenedores

```bash
docker compose ps
```

Estado esperado:

| Contenedor | Estado correcto |
|-----------|----------------|
| `emaseo-postgres` | `healthy` |
| `emaseo-minio` | `healthy` |
| `emaseo-minio-init` | `exited (0)` — **normal**, ya creó el bucket |
| `emaseo-redis` | `healthy` |
| `emaseo-auth` | `healthy` |
| `emaseo-users` | `healthy` |
| `emaseo-image` | `healthy` |
| `emaseo-gateway` | `healthy` |
| `emaseo-ml-api` | `healthy` (puede tardar ~60 s la primera vez) |
| `emaseo-ml-worker-1` | `healthy` (verifica con `celery inspect ping`) |
| `emaseo-flower` | `running` |

### Verificaciones rápidas

```bash
# 1. Gateway activo
curl http://localhost:4000/health
# → {"status":"ok"}

# 2. Imagen de ejemplo accesible a través del proxy (reemplaza <uuid> con un ID real)
curl -I http://localhost:4000/api/media/emaseo-incidents/incidents/<uuid>.jpg
# → HTTP/1.1 200 OK   Content-Type: image/jpeg   Cache-Control: public, max-age=3600, immutable

# 3. Base de datos — schemas correctos
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO -c "\dn"
# → ai | audit | auth | incidents | notifications | operations | public

# 4. ML Worker activo
docker compose logs ml-worker --tail=5
# → "worker@... ready."

# 5. Modo ML — real o dummy
docker compose logs ml-api --tail=5
# → modo real:  "mode":"rtdetr_l_best.pt"
# → modo dummy: "mode":"dummy"
```

### URLs de acceso

| Servicio | URL | Disponible |
|---------|-----|------------|
| **API Gateway** | `http://localhost:4000` | Siempre |
| **Swagger UI** | `http://localhost:4000/api-docs` | Siempre |
| **Panel Supervisor** | `http://localhost:5173` | Con `npm run dev` activo |
| **MinIO Console** | `http://localhost:9001` | Solo con `-Dev` |
| **Flower (Celery)** | `http://localhost:5555` | Solo con `-Dev` |

---

## 9. Operación diaria

### Levantar (sin reconstruir)

```powershell
# Windows
.\start.ps1 -NoBuild

# Linux / macOS
bash start.sh --no-build

# Manual
docker compose up -d
```

### Ver estado y logs

```bash
docker compose ps

# Logs en tiempo real de un servicio
docker compose logs -f api-gateway
docker compose logs -f ml-worker
docker compose logs -f image-service
```

### Acceder a la base de datos

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO
```

### Reconstruir solo un servicio (después de cambios en el código)

```bash
# Reconstruir y reiniciar un servicio específico
docker compose up -d --build api-gateway
docker compose up -d --build image-service
docker compose up -d --build ml-api ml-worker  # siempre juntos (comparten imagen)
```

> **Recuerda:** `ml-api` y `ml-worker` usan el mismo Dockerfile. Si cambias `tasks.py`, `ml_utils.py` o `config_classes.py`, reconstruye **ambos** con `--build ml-api ml-worker`.

### Escalar ML Workers

```bash
# 3 workers en paralelo (útil para pruebas de carga)
docker compose up -d --scale ml-worker=3
```

### Ver tareas en Flower

```bash
# Primero expón el puerto (requiere reinicio con -Dev)
.\start.ps1 -Dev
# Luego abre: http://localhost:5555
# Credenciales: FLOWER_USER / FLOWER_PASSWORD del .env
```

---

## 10. Correr tests del ML

Los tests unitarios del servicio de clasificación ML se ejecutan localmente (sin Docker):

```bash
cd Backend/ml-service

# Activar el entorno virtual
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux / macOS

# Correr todos los tests (30 casos)
python -m pytest tests/test_classification_bands.py -v
```

Salida esperada:
```
30 passed in 0.15s
```

Los tests cubren:
- `coverage_union` — unión de bboxes (no suma), evita inflación por solapamiento
- `is_clustered` — detección de close-ups con múltiples cajas
- Escenario del vaso/taza — el falso CRÍTICO reportado
- Escenarios reales: BAJO, MEDIO, ALTO, CRÍTICO
- Invariantes de las bandas de severidad

> Si agregas nuevos casos de prueba (fotos reales de incidentes), añádelos en `Backend/ml-service/tests/test_classification_bands.py` y corre los tests antes de hacer commit.

---

## 11. Detener el sistema

### Parar (conserva los datos)

```bash
docker compose down
```

Los volúmenes `emaseo_postgres_data`, `emaseo_minio_data`, `emaseo_redis_data` se conservan y los datos persisten.

### Reset completo (borra todos los datos)

```bash
# ⚠ IRREVERSIBLE — elimina BD, imágenes subidas, tareas y secretos de Redis
docker compose down -v
```

Úsalo solo para empezar desde cero (por ejemplo, probar la inicialización del schema desde cero).

---

## 12. Solución de problemas

### Diagnóstico en 30 segundos

```bash
# Ver el estado de todos los contenedores de una vez
docker compose ps

# Ver los últimos errores de un servicio
docker compose logs <servicio> --tail=30

# Servicios: postgres | minio | redis | auth-service | users-service | image-service | api-gateway | ml-api | ml-worker
```

---

### `emaseo-ml-worker-1` aparece como `unhealthy`

El worker Celery no expone un servidor HTTP — su healthcheck verifica que responda a `celery inspect ping`. Si aparece unhealthy justo después de arrancar, espera 40 s (`start_period`) antes de preocuparte.

```bash
docker compose logs ml-worker --tail=20
# Debe mostrar: "worker@... ready."
```

Si el worker está procesando tareas correctamente pero el healthcheck falla sistemáticamente:
```bash
docker compose restart ml-worker
```

---

### `emaseo-ml-api` sigue en `starting` después de 2 minutos

```bash
docker compose logs ml-api
```

Causas comunes:
- `DUMMY_MODE=false` y el archivo `ML/modelos/rtdetr_l_best.pt` no existe → usa `DUMMY_MODE=true` para pruebas sin el modelo real.
- RAM insuficiente → el modelo necesita ~1 GB de RAM libre.

---

### Las imágenes no se cargan en el panel (`ERR_CONNECTION_REFUSED` o `404`)

Las imágenes se sirven a través del API Gateway en `http://localhost:4000/api/media/...`. Verifica:

```bash
# ¿El gateway está healthy?
curl http://localhost:4000/health

# ¿La imagen existe en MinIO? (reemplaza <uuid>)
curl -I http://localhost:4000/api/media/emaseo-incidents/incidents/<uuid>.jpg
# → debe devolver HTTP 200
```

Si el gateway devuelve **502**: MinIO no está running.
```bash
docker compose logs minio --tail=10
docker compose restart minio
```

Si la app móvil no ve las imágenes: `S3_PUBLIC_URL` debe usar la IP de red, no `localhost`:
```env
# ✗ El celular no puede resolver localhost del servidor
S3_PUBLIC_URL=http://localhost:4000/api/media

# ✓ Correcto — IP de red, puerto 4000 (gateway)
S3_PUBLIC_URL=http://192.168.1.42:4000/api/media
```

---

### El panel web da error `value.toFixed is not a function`

Esto ocurría cuando `volumen_estimado_m3` llegaba como string desde la BD.  
**Ya está corregido** en `image-service/src/db.js` y `users-service/src/db.js` con `pg.types.setTypeParser`.  
Si vuelve a ocurrir, asegúrate de haber reconstruido esos servicios:

```bash
docker compose up -d --build image-service users-service
```

---

### Puerto 4000 ocupado

```powershell
# Windows
netstat -ano | findstr :4000
```
```bash
# Linux / macOS
lsof -i :4000
```

Termina el proceso conflictivo o cambia el puerto en `docker-compose.yml`.

---

### Los correos OTP no llegan

```bash
docker compose logs auth-service | grep -i "smtp\|email\|error"
```

- Verifica las variables `SMTP_*` en `.env`.
- Gmail requiere **App Password** — ver sección 3.
- Puerto 587 debe estar abierto en el firewall/antivirus.

---

### `EXPOSE_DEV_PORTS=false` no desactiva los puertos

`false` es una cadena **no vacía** y activa los puertos. Para desactivarlos, deja la variable **vacía**:
```env
EXPOSE_DEV_PORTS=
```

---

### Error de autenticación PostgreSQL al reiniciar

Si cambiaste `POSTGRES_PASSWORD` pero el volumen tiene la contraseña anterior:
```bash
# ⚠ Borra todos los datos
docker compose down -v
docker compose up -d --build
```

---

### Circuit Breaker abierto — ML degradado

Si el panel muestra "El servicio de análisis visual está temporalmente degradado":
```bash
docker compose logs ml-api --tail=30
docker compose logs ml-worker --tail=30
# El circuit breaker se cierra automáticamente en ~30 s si el ML se recupera.
# Si no, reinicia manualmente:
docker compose restart ml-api ml-worker
```

---

### El túnel Cloudflare no muestra URL

- Verifica conexión a internet.
- Verifica que cloudflared esté en el PATH: `cloudflared --version`
- Verifica que el gateway responda: `curl http://localhost:4000/health`

---

## 13. Nota de producción

Para despliegue en producción, ajusta estas variables en `.env`:

| Variable | Desarrollo | Producción |
|----------|-----------|-----------|
| `EXPOSE_DEV_PORTS` | `true` | `` (vacío — nunca exponer MinIO/Redis/Flower) |
| `DUMMY_MODE` | `true` | `false` (requiere `ML/modelos/rtdetr_l_best.pt`) |
| `S3_PUBLIC_URL` | `http://localhost:4000/api/media` | URL pública con TLS del gateway |
| `CORS_ORIGINS` | `http://localhost:5173` | Dominio real del panel web |
| `SMTP_*` | Servidor de prueba | SMTP corporativo o servicio transaccional |

Además:
- Configura un **proxy inverso** (Nginx, Caddy, Traefik) con TLS delante del puerto 4000.
- Habilita backups automáticos del volumen `emaseo_postgres_data`.
- Para GPU NVIDIA: descomenta el bloque `reservations` en `docker-compose.yml` e instala el [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/).

---

## 14. Referencia rápida de comandos

### Backend (Docker)

```powershell
.\start.ps1              # Windows — primera vez (genera .env + build + up)
.\start.ps1 -NoBuild     # Windows — inicio rápido
.\start.ps1 -Dev         # Windows — con puertos admin (MinIO :9001, Redis :6379, Flower :5555)
.\start.ps1 -Build       # Windows — forzar reconstrucción de imágenes
```

```bash
bash start.sh            # Linux/macOS — primera vez
bash start.sh --no-build # Linux/macOS — inicio rápido
bash start.sh --dev      # Linux/macOS — con puertos admin
```

```bash
docker compose up -d --build   # Manual — primera vez
docker compose up -d           # Manual — inicio rápido
docker compose ps              # Estado de contenedores
docker compose logs -f <svc>   # Logs en vivo
docker compose down            # Parar (conserva datos)
docker compose down -v         # ⚠ Reset total (borra datos)
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO  # Consola BD
```

### Reconstruir servicios específicos

```bash
docker compose up -d --build api-gateway          # Proxy de media, rutas
docker compose up -d --build image-service        # Orquestador de reportes
docker compose up -d --build users-service        # Gestión de usuarios
docker compose up -d --build ml-api ml-worker     # ML — siempre juntos
```

### Tests del ML

```bash
cd Backend/ml-service
venv\Scripts\activate                             # Windows
python -m pytest tests/test_classification_bands.py -v
```

### Panel de Supervisor

```bash
cd Frontend/supervisor-panel
npm install          # solo la primera vez
npm run dev          # → http://localhost:5173
npm run build        # compilar para producción
```

### App Móvil

```bash
cd Frontend/smart-waste-mobile
npm install          # solo la primera vez
npx expo start       # red local (misma WiFi)
npx expo start -c    # limpiar caché
npx expo start --tunnel -c   # acceso remoto
```

### Túnel Cloudflare

```powershell
.\start-remote.ps1          # Windows — modo remoto completo (2 túneles + Expo)
.\start.ps1 -Tunnel         # Windows — solo túnel API
```
```bash
bash tools/start-tunnel.sh  # Linux/WSL — solo túnel API
cloudflared tunnel --url http://localhost:4000  # manual
```
