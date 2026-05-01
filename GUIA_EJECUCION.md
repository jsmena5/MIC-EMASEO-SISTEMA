# Guía de Ejecución — MIC-EMASEO Sistema

> Manual del desarrollador. Tres fases: entiende la arquitectura, instala desde cero, opera día a día.

---

## Índice

- [Fase 1 — Glosario y Arquitectura](#fase-1--glosario-y-arquitectura)
- [Fase 2 — Instalación desde Cero](#fase-2--instalación-desde-cero)
  - [2.1 Clonar el repositorio](#21-clonar-el-repositorio)
  - [2.2 Variables de entorno (.env)](#22-variables-de-entorno-env)
  - [2.3 Docker — Toda la infraestructura](#23-docker--toda-la-infraestructura)
  - [2.4 Dependencias Node.js](#24-dependencias-nodejs)
  - [2.5 Supervisor Panel (React Web)](#25-supervisor-panel-react-web)
  - [2.6 Aplicación móvil (Expo)](#26-aplicación-móvil-expo)
  - [2.7 Python venv (solo desarrollo avanzado del ML)](#27-python-venv-solo-desarrollo-avanzado-del-ml)
- [Fase 3 — Rutina Diaria (Cheat Sheet)](#fase-3--rutina-diaria-cheat-sheet)
  - [3.1 Levantar infraestructura Docker](#31-levantar-infraestructura-docker)
  - [3.2 Arrancar los microservicios Node.js](#32-arrancar-los-microservicios-nodejs)
  - [3.3 Arrancar el Supervisor Panel](#33-arrancar-el-supervisor-panel)
  - [3.4 Arrancar la app móvil](#34-arrancar-la-app-móvil)
  - [3.5 Lista de verificación](#35-lista-de-verificación)
  - [3.6 Apagar todo](#36-apagar-todo)
- [Apéndice — Puertos y URLs de referencia](#apéndice--puertos-y-urls-de-referencia)

---

## Fase 1 — Glosario y Arquitectura

### ¿Qué corre en Docker y qué corre directo en la máquina?

```
┌─── docker compose up -d ────────────────────────────────────┐
│  PostgreSQL :5432   Redis :6379   MinIO :9000/:9001          │
│  ML API :8000       ML Worker     Flower :5555               │
└─────────────────────────────────────────────────────────────┘

┌─── Terminales locales ──────────────────────────────────────┐
│  Auth Service    :3002   (npm run dev)                       │
│  Users Service   :3000   (npm run dev)                       │
│  Image Service   :5000   (npm run dev)                       │
│  API Gateway     :4000   (npm run dev)   ← punto de entrada  │
│  Supervisor Panel :5173  (npm run dev)   ← dashboard web     │
│  Expo Dev Server         (npx expo start) ← app móvil       │
└─────────────────────────────────────────────────────────────┘
```

**Por qué Docker para la infraestructura:** PostgreSQL necesita PostGIS, MinIO emula S3, Redis actúa de broker para Celery. Docker garantiza que todos los desarrolladores tengan exactamente el mismo entorno sin instalar nada manualmente.

**Por qué Node.js y Expo locales:** hot-reload instantáneo y debugging más cómodo. Cuando cambias un archivo, el servicio se reinicia solo.

**Por qué el ML Service va en Docker:** FastAPI + Celery Worker comparten un volumen de uploads; gestionarlos juntos con Docker es más simple y reproduce fielmente el entorno de producción.

### ¿Por qué MinIO en lugar de AWS S3?

MinIO es un servidor de object-storage 100% compatible con la API de S3. En desarrollo lo corremos localmente para no necesitar credenciales AWS ni generar costos. En producción solo cambian las variables de entorno.

> **Punto crítico para móvil**: si `S3_PUBLIC_URL` apunta a `localhost`, el celular no sabrá a qué IP conectarse. **Siempre usa la IP local de tu red** (ej. `http://192.168.1.10:9000`).

### Flujo de una foto de basura

```
App móvil (Expo)
   │ HTTPS
   ▼
API Gateway :4000  — valida JWT, enruta
   │ HTTP interno
   ▼
Image Service :5000 — sube a MinIO, encola tarea ML
   │ HTTP interno
   ▼
ML API :8000 (FastAPI) — encola en Redis
   │ Celery task
   ▼
ML Worker — carga RT-DETR-L, infiere, devuelve resultado
```

El ML Service carga el modelo **una sola vez** al iniciar. Las peticiones posteriores son rápidas (300-800 ms); solo el primer arranque puede tardar 30-90 segundos mientras carga los pesos a memoria.

> **DUMMY_MODE**: el `docker-compose.yml` arranca el ML en modo ficticio (`DUMMY_MODE=true`) para desarrollo rápido. El endpoint `/predict` devuelve resultados simulados sin necesitar el archivo `.pt`. Para inferencia real ver sección [2.7](#27-python-venv-solo-desarrollo-avanzado-del-ml).

---

## Fase 2 — Instalación desde Cero

> Ejecuta estas secciones **en orden la primera vez**. En sesiones posteriores ve directo a la [Fase 3](#fase-3--rutina-diaria-cheat-sheet).

### 2.1 Clonar el repositorio

```bash
git clone https://github.com/jsmena5/MIC-EMASEO-SISTEMA.git
cd MIC-EMASEO-SISTEMA
```

### 2.2 Variables de entorno (.env)

Cada microservicio tiene su propio `.env`. Copia los ejemplos y edítalos:

```bash
# Windows PowerShell
Copy-Item Backend/auth-service/.env.example    Backend/auth-service/.env
Copy-Item Backend/users-service/.env.example   Backend/users-service/.env
Copy-Item Backend/image-service/.env.example   Backend/image-service/.env

# Crea manualmente Backend/api-gateway/.env (no tiene .env.example)
```

#### Auth Service — `Backend/auth-service/.env`

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PORT` | `3002` | Puerto del servicio |
| `JWT_SECRET` | `cambiar_en_produccion_32chars` | Secreto para firmar JWT (mínimo 32 chars) |
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_NAME` | `MIC-EMASEO` | Nombre de la base de datos |
| `DB_USER` | `postgres` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `postgres` | Contraseña (definida en docker-compose.yml) |
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP para envío de OTPs |
| `SMTP_PORT` | `587` | Puerto SMTP (TLS) |
| `SMTP_USER` | `tu_email@gmail.com` | Correo remitente |
| `SMTP_PASS` | `xxxx xxxx xxxx xxxx` | Contraseña de aplicación Gmail |
| `EMAIL_FROM` | `EMASEO EP <tu_email@gmail.com>` | Nombre visible en el email |

> **Contraseña de aplicación Gmail**: entra a [myaccount.google.com](https://myaccount.google.com) → Seguridad → Verificación en 2 pasos → Contraseñas de aplicación. Genera una contraseña específica para este proyecto.

#### Users Service — `Backend/users-service/.env`

Mismo set de variables que Auth Service. Solo cambia `PORT=3000`.

#### Image Service — `Backend/image-service/.env`

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PORT` | `5000` | Puerto del servicio |
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_NAME` | `MIC-EMASEO` | Nombre de la base de datos |
| `DB_USER` | `postgres` | Usuario |
| `DB_PASSWORD` | `postgres` | Contraseña |
| `ML_SERVICE_URL` | `http://localhost:8000/predict` | URL interna del ML Service (Docker expone 8000) |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO local |
| `S3_BUCKET` | `emaseo-incidents` | Nombre del bucket (creado automáticamente) |
| `S3_ACCESS_KEY` | `minioadmin` | Credencial MinIO |
| `S3_SECRET_KEY` | `minioadmin` | Credencial MinIO |
| `S3_REGION` | `us-east-1` | Cualquier valor para MinIO local |
| `S3_PUBLIC_URL` | `http://192.168.1.10:9000` | **⚠ Usar IP de red local, NO localhost** |

> **Encontrar tu IP local:**
> ```powershell
> # Windows PowerShell
> (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' }).IPAddress
>
> # o con ipconfig
> ipconfig | findstr "IPv4"
> ```

#### API Gateway — `Backend/api-gateway/.env`

Crea el archivo manualmente (no existe `.env.example`):

```env
PORT=4000
JWT_SECRET=cambiar_en_produccion_32chars
AUTH_SERVICE_URL=http://localhost:3002
USERS_SERVICE_URL=http://localhost:3000
IMAGE_SERVICE_URL=http://localhost:5000
```

> `JWT_SECRET` debe ser **idéntico** al valor configurado en Auth Service.

### 2.3 Docker — Toda la infraestructura

#### Prerequisito: Docker Desktop corriendo

```powershell
docker info
```

Si el comando falla, abre Docker Desktop y espera a que el daemon inicie.

#### Primera vez — construir imágenes y levantar

```bash
docker compose up -d --build
```

El flag `--build` compila la imagen del ML Service (`Backend/ml-service/Dockerfile`). Solo es necesario la primera vez o cuando cambia el `Dockerfile` o `requirements.txt`.

#### Verificar que todos los contenedores están en pie

```bash
docker compose ps
```

Estado esperado:

| Contenedor | Estado |
|-----------|--------|
| `emaseo-postgres` | `healthy` |
| `emaseo-minio` | `healthy` |
| `emaseo-minio-init` | `exited (0)` — normal, ya creó el bucket |
| `emaseo-redis` | `healthy` |
| `emaseo-ml-api` | `healthy` (puede tardar ~30s la primera vez) |
| `emaseo-ml-api-ml-worker-1` | `running` |
| `emaseo-flower` | `running` |

#### Verificar la base de datos

El esquema completo se aplica automáticamente desde `Backend/database/01_init_schema.sql` y los datos de prueba desde `02_seed_data.sql`. Para confirmar:

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO -c "\dn"
```

Debes ver los schemas: `auth`, `public`, `operations`, `incidents`, `ai`, `notifications`.

#### Si necesitas aplicar migraciones adicionales manualmente

```bash
# Ejemplo: migración de refresh tokens
docker exec -i emaseo-postgres psql -U postgres -d MIC-EMASEO < Backend/database/008_refresh_tokens.sql

# Ejemplo: migración de password reset
docker exec -i emaseo-postgres psql -U postgres -d MIC-EMASEO < Backend/database/009_password_reset_tokens.sql
```

#### Acceder a las UIs de administración

| Servicio | URL | Usuario | Contraseña |
|---------|-----|---------|-----------|
| MinIO Console | http://localhost:9001 | `minioadmin` | `minioadmin` |
| Flower (Celery) | http://localhost:5555 | — | — |
| ML API Swagger | http://localhost:8000/docs | — | — |

### 2.4 Dependencias Node.js

Instala las dependencias de cada microservicio (desde la raíz del repo):

```powershell
# Windows PowerShell — uno por uno
npm install --prefix Backend/api-gateway
npm install --prefix Backend/auth-service
npm install --prefix Backend/users-service
npm install --prefix Backend/image-service
```

### 2.5 Supervisor Panel (React Web)

```bash
cd Frontend/supervisor-panel
npm install
```

#### Verificar la URL del API Gateway

El archivo `Frontend/supervisor-panel/.env` debe apuntar a tu gateway:

```env
VITE_API_URL=http://localhost:4000/api
```

Si vas a usar el panel desde otro equipo o con túnel, cambia `localhost` por la IP o URL del túnel.

### 2.6 Aplicación móvil (Expo)

```bash
cd Frontend/smart-waste-mobile
npm install
```

#### Configurar la URL del API Gateway en la app

```env
# Frontend/smart-waste-mobile/.env.development
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api
```

Reemplaza `192.168.1.10` con tu IP local (la misma que pusiste en `S3_PUBLIC_URL`).

> Si vas a usar túnel (Cloudflare/Ngrok), cambia este valor por la URL del túnel antes de arrancar Expo. Ver sección [3.4](#34-arrancar-la-app-móvil).

### 2.7 Python venv (solo desarrollo avanzado del ML)

> **Esta sección NO es necesaria para el uso diario.** El ML Service corre en Docker. Solo necesitas el venv si vas a modificar el código Python y quieres ejecutarlo localmente fuera de Docker.

```powershell
cd Backend/ml-service

# Crear el entorno virtual
python -m venv venv

# Activar (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Instalar dependencias
pip install -r requirements.txt
```

Para activar el modelo real (inferencia RT-DETR-L), el archivo `ML/modelos/rtdetr_l_best.pt` debe existir. Si no lo tienes, contáctate con el equipo.

Para correr el ML localmente (en lugar de Docker):

```bash
# Con el venv activo
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## Fase 3 — Rutina Diaria (Cheat Sheet)

> Cada día de desarrollo sigues estos pasos en orden. Abre **6 terminales** (o usa pestañas en Windows Terminal).

### 3.1 Levantar infraestructura Docker

**Terminal 1**

```bash
docker compose up -d

# Confirmar estado
docker compose ps
```

Esto levanta PostgreSQL, MinIO, Redis, ML API, ML Worker y Flower. Si ya estaban corriendo del día anterior, el comando no hace nada dañino — es idempotente.

> Si el `emaseo-ml-api` muestra `starting` en lugar de `healthy`, espera 30 segundos y vuelve a ejecutar `docker compose ps`. El modelo puede tardar en cargar.

### 3.2 Arrancar los microservicios Node.js

Usa `npm run dev` en lugar de `npm start` para tener hot-reload (el servicio se reinicia solo al guardar cambios).

**Terminal 2 — Auth Service**

```bash
cd Backend/auth-service
npm run dev
# Escucha en :3002
```

**Terminal 3 — Users Service**

```bash
cd Backend/users-service
npm run dev
# Escucha en :3000
```

**Terminal 4 — Image Service**

```bash
cd Backend/image-service
npm run dev
# Escucha en :5000
```

**Terminal 5 — API Gateway**

```bash
cd Backend/api-gateway
npm run dev
# Escucha en :4000  ← único puerto expuesto al cliente
```

> Levanta el Gateway **último**, después de que los demás servicios ya estén escuchando.

### 3.3 Arrancar el Supervisor Panel

**Terminal 6**

```bash
cd Frontend/supervisor-panel
npm run dev
# Vite abre http://localhost:5173
```

Abre [http://localhost:5173](http://localhost:5173) en tu navegador para ver el dashboard del supervisor.

### 3.4 Arrancar la app móvil

**Terminal 7**

```bash
cd Frontend/smart-waste-mobile
```

#### Opción A — Red local (LAN) — Recomendado para desarrollo normal

```bash
npx expo start
```

Escanea el QR con **Expo Go** (Android) o la cámara (iOS). El celular y la computadora deben estar en la misma red WiFi.

#### Opción B — Limpiar caché — Usar cuando hay comportamiento extraño

```bash
npx expo start -c
```

Útil cuando cambias dependencias nativas, actualizas `app.json`, o el bundle parece desactualizado.

#### Opción C — Túnel público (Cloudflare) — Para demo o evaluación remota

Cuando el evaluador está fuera de tu red local:

**Paso 1** — Exponer el API Gateway:

```bash
cloudflared tunnel --url http://localhost:4000
```

Cloudflare imprimirá una URL del estilo `https://xxxx-xxxx.trycloudflare.com`.

**Paso 2** — Actualizar `Frontend/smart-waste-mobile/.env.development`:

```env
EXPO_PUBLIC_API_URL=https://xxxx-xxxx.trycloudflare.com/api
```

**Paso 3** — Arrancar Expo con túnel:

```bash
npx expo start --tunnel
```

> Cada vez que reinicias `cloudflared` genera una URL diferente. Recuerda actualizar `.env.development` y reiniciar Expo (`Ctrl+C` + `npx expo start --tunnel`).

### 3.5 Lista de verificación

Antes de comenzar a probar, confirma que todo responde:

```bash
# Gateway responde
curl http://localhost:4000/health

# ML Service responde (Docker)
curl http://localhost:8000/health

# Flower dashboard accesible
start http://localhost:5555

# Supervisor Panel accesible
start http://localhost:5173
```

Respuesta esperada del ML Service:

```json
{"status": "ok", "mode": "dummy"}
```

En modo `DUMMY_MODE=true` el campo `mode` es `dummy`. Cuando esté configurado con el modelo real será `rtdetr_l_best.pt`.

#### Verificar logs de un contenedor Docker

```bash
# Ver logs en tiempo real
docker compose logs -f ml-api
docker compose logs -f ml-worker
docker compose logs -f postgres
```

### 3.6 Apagar todo

#### Apagar los servicios Node.js y Expo

`Ctrl+C` en cada terminal.

#### Apagar Docker (mantiene los datos)

```bash
docker compose down
```

Los volúmenes `postgres_data`, `minio_data` y `redis_data` se conservan. La próxima vez que levantes Docker, tus datos estarán intactos.

#### Apagar Docker y borrar todos los datos (reset completo)

```bash
# ⚠ Esto borra la base de datos, las imágenes almacenadas y las tareas Celery pendientes
docker compose down -v
```

Úsalo solo si quieres empezar desde cero (ej. para probar el script de inicialización del schema).

---

## Apéndice — Puertos y URLs de referencia

| Servicio | URL local | Quién accede |
|----------|-----------|-------------|
| API Gateway | `http://localhost:4000` | App móvil y Supervisor Panel |
| Auth Service | `http://localhost:3002` | Solo interno (via Gateway) |
| Users Service | `http://localhost:3000` | Solo interno (via Gateway) |
| Image Service | `http://localhost:5000` | Solo interno (via Gateway) |
| ML API (Docker) | `http://localhost:8000` | Image Service |
| ML Swagger UI | `http://localhost:8000/docs` | Desarrollo / testing |
| ML Health | `http://localhost:8000/health` | Verificar modelo |
| PostgreSQL | `localhost:5432` | DB: `MIC-EMASEO`, user: `postgres` |
| MinIO API (S3) | `http://localhost:9000` | Image Service (uploads) |
| MinIO Console | `http://localhost:9001` | Administración manual |
| Redis | `localhost:6379` | Interno (Celery broker) |
| Flower Dashboard | `http://localhost:5555` | Monitoreo de tareas ML |
| Supervisor Panel | `http://localhost:5173` | Supervisores (web) |

### Resumen de comandos críticos

```bash
# Primera vez: construir imagen ML y levantar todo
docker compose up -d --build

# Día a día: levantar infra (sin rebuild)
docker compose up -d

# Ver estado de contenedores
docker compose ps

# Ver logs en tiempo real
docker compose logs -f ml-api
docker compose logs -f postgres

# Conectarse a la DB directamente
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO

# Listar objetos en el bucket de MinIO
docker exec emaseo-minio mc ls local/emaseo-incidents

# Escalar ML Workers (para pruebas de carga)
docker compose up -d --scale ml-worker=3

# Ver qué proceso usa un puerto (Windows)
netstat -ano | findstr :4000
```

### Secuencia de arranque completa (copiar/pegar)

```powershell
# Terminal 1 — Infraestructura Docker (incluye ML)
docker compose up -d

# Terminal 2 — Auth Service
cd Backend/auth-service; npm run dev

# Terminal 3 — Users Service
cd Backend/users-service; npm run dev

# Terminal 4 — Image Service
cd Backend/image-service; npm run dev

# Terminal 5 — API Gateway (siempre el último de Node.js)
cd Backend/api-gateway; npm run dev

# Terminal 6 — Supervisor Panel
cd Frontend/supervisor-panel; npm run dev

# Terminal 7 — App móvil
cd Frontend/smart-waste-mobile; npx expo start
```
