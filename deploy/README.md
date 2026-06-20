# Despliegue en VPS — MIC-EMASEO

Guía resumida para desplegar el sistema en un VPS (Hetzner, DigitalOcean, Vultr) con:

- **PostgreSQL + PostGIS** managed en Supabase
- **Object Storage** en Cloudflare R2
- **Reverse proxy + TLS** con Caddy (Let's Encrypt automático)
- **Microservicios Node/Python** en contenedores Docker

---

## 1. Preparar Supabase

1. Crear proyecto nuevo en https://supabase.com
2. **Database → Extensions** → activar `postgis`, `pgcrypto`
3. **SQL Editor** → ejecutar en orden los archivos de `Backend/database/01_init_schema.sql` hasta `034_fix_image_urls.sql`. El script `012_db_users_isolation.sh` requiere ejecutarse manualmente como SQL (las contraseñas las eliges tú):

   ```sql
   CREATE USER auth_svc  WITH PASSWORD '<contraseña-auth>'  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
   CREATE USER users_svc WITH PASSWORD '<contraseña-users>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
   CREATE USER image_svc WITH PASSWORD '<contraseña-image>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT LOGIN;
   -- + GRANTs equivalentes (copiar del script .sh, sección 2-5)
   ```

4. Anotar el host del pooler: **Settings → Database → Connection pooling → Transaction**.
   Algo como: `aws-0-us-east-1.pooler.supabase.com` puerto `6543`.

## 2. Preparar Cloudflare R2

1. https://dash.cloudflare.com → **R2** → crear bucket `emaseo-incidents`
2. **Manage R2 API Tokens** → crear con `Object Read & Write`. Anotar `Access Key ID` y `Secret Access Key`.
3. (Opcional) **Custom domain**: `storage.tu-dominio.ec` apuntando al bucket → habilita URLs públicas legibles.
4. Endpoint S3: `https://<account-id>.r2.cloudflarestorage.com`

## 3. Preparar VPS

```bash
# Ubuntu 22.04 LTS
ssh root@<ip-vps>

# Instalar Docker + Compose plugin
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Instalar Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# Firewall: solo SSH, HTTP y HTTPS
ufw allow OpenSSH
ufw allow http
ufw allow https
ufw enable
```

## 4. Clonar y configurar

```bash
# Como usuario no-root (recomendado)
git clone https://github.com/<tu-org>/MIC-EMASEO-SISTEMA.git
cd MIC-EMASEO-SISTEMA

# Copiar plantilla y rellenar
cp .env.production.example .env
nano .env   # rellenar: DB_HOST, DB_PASSWORD_*, S3_*, JWT_SECRET, etc.

# Modelo ML (no commiteado por tamaño)
mkdir -p ML/modelos
scp tu-laptop:ruta/rtdetr_l_best.pt ML/modelos/

# Caddy
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# Editar dominios en /etc/caddy/Caddyfile
sudo systemctl restart caddy
```

## 5. Lanzar el stack

```bash
# Con imágenes pre-construidas (publicadas por CI a GHCR)
export REGISTRY=ghcr.io/tu-org
export TAG=latest
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d

# O construyendo localmente (más lento)
docker compose -f docker-compose.prod.yml up -d --build

# Verificar
docker compose -f docker-compose.prod.yml ps
curl -I https://api.tu-dominio.ec/health
```

## 6. Supervisor-panel

Dos opciones:

### Opción A — En el mismo VPS (con Caddy)
```bash
docker run -d --name emaseo-panel \
  --restart unless-stopped \
  -p 127.0.0.1:8080:80 \
  --build-arg VITE_API_URL=https://api.tu-dominio.ec/api \
  ghcr.io/tu-org/supervisor-panel:latest
```
El bloque `panel.tu-dominio.ec` del Caddyfile ya lo proxea.

### Opción B — Cloudflare Pages / Vercel (CDN global, gratis)
1. Conectar el repo en Pages/Vercel.
2. Root directory: `Frontend/supervisor-panel`
3. Build command: `npm run build`
4. Variable `VITE_API_URL=https://api.tu-dominio.ec/api`
5. Añadir el dominio resultante (`panel.pages.dev` o el custom) a `CORS_ORIGINS` del `.env` del VPS.

## 7. App móvil (Expo)

```bash
cd Frontend/smart-waste-mobile

# .env.production
echo "EXPO_PUBLIC_API_URL=https://api.tu-dominio.ec/api" > .env.production

# Build con EAS (cuenta gratis en expo.dev)
npm install -g eas-cli
eas login
eas build --profile production --platform android
# → .apk para distribución directa o subir a Play Store
```

## 8. CI/CD

`.github/workflows/ci.yml` ya está configurado:
- En cada **PR**: corre lint + typecheck + tests
- En push a **main**: además publica imágenes Docker a GHCR (`ghcr.io/<org>/<service>:latest` y `:<sha>`)

Para auto-deploy: añadir al final del workflow un job que SSH al VPS y ejecute `docker compose -f docker-compose.prod.yml pull && up -d`. Requiere secreto `VPS_SSH_KEY` y `VPS_HOST`.

## 9. Backups

```bash
# Supabase: backups automáticos en plan Pro. En Free, dump diario manual:
pg_dump "postgresql://<usuario>:<pw>@<host>:5432/postgres" --no-owner --no-acl \
  > backups/$(date -u +%Y%m%d).sql

# R2: replication a otro bucket vía rclone (recomendado)
```

## 10. Monitoreo

- Logs: `docker compose -f docker-compose.prod.yml logs -f <servicio>`
- Healthchecks: `docker ps` muestra status
- Flower (Celery): solo accesible vía túnel SSH o detrás de Caddy con autenticación
- Para monitoreo serio: integrar Sentry, Grafana Cloud, o Better Stack.
