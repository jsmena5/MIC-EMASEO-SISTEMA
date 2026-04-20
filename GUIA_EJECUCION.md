# Guía de Ejecución — MIC-EMASEO Sistema

> Manual del desarrollador. Tres fases: entiende la arquitectura, instala desde cero, opera día a día.

---

## Índice

- [Fase 1 — Glosario y Arquitectura](#fase-1--glosario-y-arquitectura)
- [Fase 2 — Instalación desde Cero](#fase-2--instalación-desde-cero)
  - [2.1 Clonar el repositorio](#21-clonar-el-repositorio)
  - [2.2 Variables de entorno (.env)](#22-variables-de-entorno-env)
  - [2.3 Docker — Base de datos y almacenamiento](#23-docker--base-de-datos-y-almacenamiento)
  - [2.4 Entorno virtual Python (ML Service)](#24-entorno-virtual-python-ml-service)
  - [2.5 Dependencias Node.js](#25-dependencias-nodejs)
  - [2.6 Aplicación móvil (Expo)](#26-aplicación-móvil-expo)
- [Fase 3 — Rutina Diaria (Cheat Sheet)](#fase-3--rutina-diaria-cheat-sheet)
  - [3.1 Levantar infraestructura Docker](#31-levantar-infraestructura-docker)
  - [3.2 Arrancar los microservicios Node.js](#32-arrancar-los-microservicios-nodejs)
  - [3.3 Arrancar el ML Service](#33-arrancar-el-ml-service)
  - [3.4 Arrancar la app móvil](#34-arrancar-la-app-móvil)
  - [3.5 Apagar todo](#35-apagar-todo)
- [Apéndice — Puertos y URLs de referencia](#apéndice--puertos-y-urls-de-referencia)

---

## Fase 1 — Glosario y Arquitectura

### ¿Por qué Docker?

Los servicios de infraestructura (base de datos y almacenamiento de imágenes) corren en contenedores Docker para que todos los desarrolladores tengan exactamente el mismo entorno sin instalar PostgreSQL ni configurar extensiones PostGIS manualmente. Los volúmenes Docker persisten los datos entre reinicios; si necesitas empezar desde cero, borra los volúmenes (ver sección [3.5](#35-apagar-todo)).

Los microservicios Node.js y el ML Service **no** corren en Docker durante el desarrollo — se levantan directamente en la máquina para facilitar el hot-reload y el debugging.

### ¿Por qué MinIO en lugar de AWS S3?

MinIO es un servidor de object-storage 100% compatible con la API de S3. En desarrollo lo corremos localmente (dentro de Docker) para no necesitar credenciales AWS ni generar costos. En producción se cambia el endpoint a S3 real sin modificar una sola línea de código — solo cambian las variables de entorno.

> **Punto crítico para móvil**: la app en el celular necesita descargar las fotos de los reportes. Si `S3_PUBLIC_URL` apunta a `localhost`, el celular no sabrá a qué IP conectarse. **Siempre usa la IP local de tu red** (ej. `http://192.168.1.10:9000`) para que el teléfono pueda acceder a MinIO.

### ¿Cómo se comunican los servicios con el modelo Python?

```
App móvil
   │  HTTPS
   ▼
API Gateway :4000  (Node.js — punto de entrada único)
   │  HTTP interno
   ▼
Image Service :5000  (Node.js)
   │  HTTP interno
   ▼
ML Service :8000  (Python / FastAPI)
   │  Carga modelo
   ▼
RT-DETR-L  (ML/modelos/rtdetr_l_best.pt)
```

El ML Service carga el modelo **una sola vez** al iniciar. Las peticiones posteriores son rápidas (300-800 ms); solo el primer arranque puede tardar 30-90 segundos mientras carga los pesos a memoria.

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
cp Backend/auth-service/.env.example    Backend/auth-service/.env
cp Backend/users-service/.env.example   Backend/users-service/.env
cp Backend/image-service/.env.example   Backend/image-service/.env
cp Backend/api-gateway/.env.example     Backend/api-gateway/.env
```

#### Auth Service — `Backend/auth-service/.env`

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PORT` | `3002` | Puerto del servicio |
| `JWT_SECRET` | `cambiar_en_produccion` | Secreto para firmar JWT (mínimo 32 chars) |
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_NAME` | `MIC-EMASEO` | Nombre de la base de datos |
| `DB_USER` | `postgres` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `postgres` | Contraseña de PostgreSQL |
| `SMTP_HOST` | `smtp.gmail.com` | Servidor SMTP para envío de OTPs |
| `SMTP_PORT` | `587` | Puerto SMTP (TLS) |
| `SMTP_USER` | `tu_email@gmail.com` | Correo remitente |
| `SMTP_PASS` | `xxxx xxxx xxxx xxxx` | Contraseña de aplicación Gmail |
| `EMAIL_FROM` | `EMASEO EP <tu_email@gmail.com>` | Nombre visible en el email |

#### Users Service — `Backend/users-service/.env`

Mismo set de variables que Auth Service (DB + SMTP). Solo cambia `PORT=3000`.

#### Image Service — `Backend/image-service/.env`

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PORT` | `5000` | Puerto del servicio |
| `DB_*` | (igual que arriba) | Conexión PostgreSQL |
| `ML_SERVICE_URL` | `http://localhost:8000/predict` | URL interna del ML Service |
| `S3_ENDPOINT` | `http://localhost:9000` | MinIO local (eliminar en producción con S3 real) |
| `S3_BUCKET` | `emaseo-incidents` | Nombre del bucket |
| `S3_ACCESS_KEY` | `minioadmin` | Credencial MinIO (cambiar en producción) |
| `S3_SECRET_KEY` | `minioadmin` | Credencial MinIO (cambiar en producción) |
| `S3_REGION` | `us-east-1` | Región (cualquier valor para MinIO local) |
| `S3_PUBLIC_URL` | `http://192.168.1.10:9000` | **⚠ Usar IP de red local, NO localhost** |

> **`S3_PUBLIC_URL` es la variable más crítica para el desarrollo móvil.**  
> Esta URL se guarda en la base de datos como prefijo de las fotos y el celular la usa para cargar las imágenes. Si pones `localhost`, el teléfono no podrá acceder a las fotos.
>
> Para encontrar tu IP local:
> ```bash
> # Windows
> ipconfig | findstr "IPv4"
>
> # macOS / Linux
> ip route get 1 | awk '{print $7; exit}'
> ```

#### API Gateway — `Backend/api-gateway/.env`

| Variable | Valor de ejemplo | Descripción |
|----------|-----------------|-------------|
| `PORT` | `4000` | Puerto del gateway |
| `JWT_SECRET` | (mismo que Auth) | Debe coincidir exactamente con Auth Service |
| `AUTH_SERVICE_URL` | `http://localhost:3002` | URL interna Auth Service |
| `USERS_SERVICE_URL` | `http://localhost:3000` | URL interna Users Service |
| `IMAGE_SERVICE_URL` | `http://localhost:5000` | URL interna Image Service |

### 2.3 Docker — Base de datos y almacenamiento

#### Verificar que Docker Desktop está corriendo

```bash
docker info
```

Si el comando falla, abre Docker Desktop y espera a que el daemon inicie.

#### Levantar los contenedores

```bash
docker compose up -d
```

Este comando levanta PostgreSQL, MinIO y el contenedor `minio-init` (que crea el bucket automáticamente y luego termina).

#### Verificar que todo está en pie

```bash
docker compose ps
```

Deberías ver `emaseo-postgres` y `emaseo-minio` en estado `healthy`. El contenedor `emaseo-minio-init` aparecerá como `exited (0)` — es normal, su trabajo ya terminó.

#### Verificar la base de datos

El esquema completo (tablas, índices, ENUMs, extensiones PostGIS) se aplica automáticamente desde `Backend/database/01_init_schema.sql` en el primer inicio. Para confirmar:

```bash
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO -c "\dn"
```

Debes ver los schemas: `auth`, `public`, `operations`, `incidents`, `ai`, `notifications`.

#### Si necesitas aplicar migraciones adicionales manualmente

```bash
# Ejemplo: migración de refresh tokens
docker exec -i emaseo-postgres psql -U postgres -d MIC-EMASEO \
  < Backend/database/008_refresh_tokens.sql

# Ejemplo: migración de password reset
docker exec -i emaseo-postgres psql -U postgres -d MIC-EMASEO \
  < Backend/database/009_password_reset_tokens.sql
```

#### Acceder a la consola de MinIO

Abre [http://localhost:9001](http://localhost:9001) en tu navegador.  
- Usuario: `minioadmin`  
- Contraseña: `minioadmin`

### 2.4 Entorno virtual Python (ML Service)

El ML Service requiere Python 3.10 o superior. Usamos `venv` para aislar las dependencias.

```bash
cd Backend/ml-service

# Crear el entorno virtual (solo la primera vez)
python -m venv venv
```

#### Activar el entorno virtual

```bash
# Windows (PowerShell)
venv\Scripts\Activate.ps1

# Windows (Git Bash / CMD)
source venv/Scripts/activate

# macOS / Linux
source venv/bin/activate
```

Cuando el venv está activo, el prompt muestra `(venv)` al inicio.

#### Instalar dependencias

```bash
pip install -r requirements.txt
```

> La primera instalación descarga PyTorch y Ultralytics — puede tardar varios minutos dependiendo de tu conexión.

#### Verificar el modelo

El modelo `rtdetr_l_best.pt` debe estar en `ML/modelos/`. Confirma:

```bash
# Desde la raíz del repo
ls ML/modelos/
# Debe mostrar: rtdetr_l_best.pt
```

Si el archivo no existe, contáctate con el equipo para obtener los pesos entrenados.

### 2.5 Dependencias Node.js

Instala las dependencias de cada microservicio:

```bash
cd Backend/api-gateway   && npm install && cd ../..
cd Backend/auth-service  && npm install && cd ../..
cd Backend/users-service && npm install && cd ../..
cd Backend/image-service && npm install && cd ../..
```

O de forma más rápida desde la raíz:

```bash
for service in api-gateway auth-service users-service image-service; do
  echo "Instalando $service..."
  npm install --prefix Backend/$service
done
```

### 2.6 Aplicación móvil (Expo)

```bash
cd Frontend/smart-waste-mobile
npm install
```

#### Configurar la URL del API Gateway en la app

La app lee la URL del API Gateway desde la variable `EXPO_PUBLIC_API_URL` definida en un archivo `.env.development` (nunca está hardcodeada). Crea ese archivo:

```bash
# Frontend/smart-waste-mobile/.env.development
EXPO_PUBLIC_API_URL=http://192.168.1.10:4000/api
```

Reemplaza `192.168.1.10` con tu IP local (la misma que pusiste en `S3_PUBLIC_URL`). Si el archivo no existe o la variable está vacía, la app lanza un error al arrancar con el mensaje exacto de qué archivo crear.

> Si vas a usar túnel (Cloudflare / Ngrok), cambia este valor por la URL del túnel antes de arrancar Expo. Ver sección [3.4](#34-arrancar-la-app-móvil).

---

## Fase 3 — Rutina Diaria (Cheat Sheet)

> Cada día de desarrollo sigues estos pasos en orden. Abre **5 terminales** (o usa pestañas).

### 3.1 Levantar infraestructura Docker

**Terminal 1**

```bash
# Verificar que Docker Desktop está corriendo, luego:
docker compose up -d

# Confirmar estado
docker compose ps
```

Si ya estaba corriendo del día anterior, este comando no hace nada dañino — es idempotente.

### 3.2 Arrancar los microservicios Node.js

Abre una terminal por servicio (o usa un multiplexor como `tmux`):

**Terminal 2 — Auth Service**

```bash
cd Backend/auth-service
npm start
# Escucha en :3002
```

**Terminal 3 — Users Service**

```bash
cd Backend/users-service
npm start
# Escucha en :3000
```

**Terminal 4 — Image Service**

```bash
cd Backend/image-service
npm start
# Escucha en :5000
```

**Terminal 5 — API Gateway**

```bash
cd Backend/api-gateway
npm start
# Escucha en :4000  ← único puerto expuesto al cliente
```

> Levanta el Gateway **último**, después de que los demás ya estén listos.

#### Verificar que el Gateway responde

```bash
curl http://localhost:4000/health
```

### 3.3 Arrancar el ML Service

**Terminal 6**

```bash
cd Backend/ml-service

# Activar venv (si no está activo)
# Navego a la carpte:
cd Backend\ml-service
#Activo en entorno virtual
.\venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# Arrancar
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

> El primer arranque carga los pesos del modelo RT-DETR-L a memoria — puede tardar **30-90 segundos**. Espera a ver el mensaje `Modelo cargado correctamente.` antes de hacer peticiones.

#### Verificar que el ML Service responde

```bash
curl http://localhost:8000/health
```

Respuesta esperada:

```json
{"status": "ok", "model": "rtdetr_l_best.pt", "model_path": "..."}
```

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

#### Opción C — Túnel público (Cloudflare / Ngrok) — Para demo o evaluación remota

Cuando el evaluador o testeador está fuera de tu red local, necesitas un túnel. El flujo es:

**Paso 1** — Exponer el API Gateway con Cloudflare Quick Tunnel (en una terminal aparte):

```bash
cloudflared tunnel --url http://localhost:4000
```

Cloudflare imprimirá una URL pública del estilo:
```
https://xxxx-xxxx-xxxx.trycloudflare.com
```

**Paso 2** — Actualizar `Frontend/smart-waste-mobile/.env.development` con esa URL:

```bash
EXPO_PUBLIC_API_URL=https://xxxx-xxxx-xxxx.trycloudflare.com/api
```

**Paso 3** — Arrancar Expo con túnel (para que el QR también sea accesible remotamente):

```bash
npx expo start --tunnel
```

> Cada vez que reinicias `cloudflared` genera una URL diferente — recuerda actualizar `.env.development` y reiniciar Expo (`Ctrl+C` + `npx expo start --tunnel`) para que tome el nuevo valor.

### 3.5 Apagar todo

#### Apagar los servicios Node.js y ML

`Ctrl+C` en cada terminal.

#### Apagar Docker (mantiene los datos)

```bash
docker compose down
```

Los volúmenes `postgres_data` y `minio_data` se conservan. La próxima vez que levantes Docker, tus datos estarán intactos.

#### Apagar Docker y borrar todos los datos (reset completo)

```bash
# ⚠ Esto borra la base de datos y todas las imágenes almacenadas
docker compose down -v
```

Úsalo solo si quieres empezar desde cero (ej. para probar el script de inicialización del schema).

---

## Apéndice — Puertos y URLs de referencia

| Servicio | URL local | Notas |
|----------|-----------|-------|
| API Gateway | `http://localhost:4000` | Único endpoint para los clientes |
| Auth Service | `http://localhost:3002` | Solo acceso interno (via Gateway) |
| Users Service | `http://localhost:3000` | Solo acceso interno (via Gateway) |
| Image Service | `http://localhost:5000` | Solo acceso interno (via Gateway) |
| ML Service | `http://localhost:8000` | Solo acceso interno (via Image Service) |
| ML Health check | `http://localhost:8000/health` | Verificar que el modelo cargó |
| ML Docs (Swagger) | `http://localhost:8000/docs` | Interfaz interactiva de FastAPI |
| PostgreSQL | `localhost:5432` | DB: `MIC-EMASEO`, user: `postgres` |
| MinIO API (S3) | `http://localhost:9000` | Endpoint S3-compatible |
| MinIO Console | `http://localhost:9001` | UI web de administración |

### Resumen de comandos críticos

```bash
# Ver logs de un contenedor en tiempo real
docker compose logs -f postgres
docker compose logs -f minio

# Conectarse a la DB directamente
docker exec -it emaseo-postgres psql -U postgres -d MIC-EMASEO

# Listar objetos en el bucket de MinIO
docker exec emaseo-minio mc ls local/emaseo-incidents

# Reinstalar dependencias Python (si cambia requirements.txt)
pip install -r Backend/ml-service/requirements.txt

# Ver qué proceso usa un puerto (Windows)
netstat -ano | findstr :4000

# Ver qué proceso usa un puerto (macOS/Linux)
lsof -i :4000
```
