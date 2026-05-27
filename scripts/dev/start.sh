#!/usr/bin/env bash
# =============================================================================
# start.sh — Arranque único del sistema MIC EMASEO
#
# Uso:
#   bash start.sh             # genera .env si no existe, construye y levanta
#   bash start.sh --build     # fuerza reconstrucción de imágenes
#   bash start.sh --no-build  # salta la construcción (imágenes ya existen)
#   bash start.sh --dev       # activa EXPOSE_DEV_PORTS para acceso local
#
# Requiere: Docker Engine 24+ con el plugin Compose v2, bash, openssl
# =============================================================================
set -euo pipefail

# ── Colores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'  # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

# ── Argumentos ────────────────────────────────────────────────────────────────
DO_BUILD=true
FORCE_BUILD=false
ENABLE_DEV_PORTS=false

for arg in "$@"; do
  case $arg in
    --build)     FORCE_BUILD=true  ;;
    --no-build)  DO_BUILD=false    ;;
    --dev)       ENABLE_DEV_PORTS=true ;;
    --help|-h)
      echo "Uso: bash start.sh [--build] [--no-build] [--dev]"
      echo "  --build     Fuerza reconstrucción de imágenes Docker"
      echo "  --no-build  Salta la construcción (usa imágenes existentes)"
      echo "  --dev       Activa EXPOSE_DEV_PORTS (MinIO, Redis, Flower accesibles)"
      exit 0
      ;;
    *)
      echo -e "${RED}Argumento desconocido: $arg${NC}" >&2
      echo "Usa --help para ver las opciones disponibles."
      exit 1
      ;;
  esac
done

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║       MIC EMASEO — Sistema de Gestión de Residuos   ║${NC}"
echo -e "${CYAN}${BOLD}║                    Arranque rápido                  ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Verificar dependencias ─────────────────────────────────────────────────
echo -e "${BLUE}[1/5]${NC} Verificando dependencias..."

if ! command -v docker &>/dev/null; then
  echo -e "${RED}ERROR: Docker no está instalado o no está en el PATH.${NC}" >&2
  echo "  Instala Docker Desktop desde https://docs.docker.com/get-docker/" >&2
  exit 1
fi

if ! docker info &>/dev/null; then
  echo -e "${RED}ERROR: El daemon de Docker no está corriendo.${NC}" >&2
  echo "  Abre Docker Desktop y espera a que inicie antes de continuar." >&2
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo -e "${RED}ERROR: docker compose (plugin v2) no está disponible.${NC}" >&2
  echo "  Actualiza Docker Desktop a la versión 24+ para incluir el plugin Compose." >&2
  exit 1
fi

DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+' | head -1)
COMPOSE_VER=$(docker compose version | grep -oP '\d+\.\d+' | head -1)
echo -e "  ${GREEN}✓${NC} Docker $DOCKER_VER"
echo -e "  ${GREEN}✓${NC} Docker Compose $COMPOSE_VER"

# ── 2. Generar .env si no existe ──────────────────────────────────────────────
echo ""
echo -e "${BLUE}[2/5]${NC} Configuración de variables de entorno..."

if [[ ! -f "$ENV_FILE" ]]; then
  echo -e "  ${YELLOW}⚠  No se encontró .env — generando secretos seguros...${NC}"

  if ! command -v openssl &>/dev/null; then
    echo -e "${RED}ERROR: openssl no está instalado. Instálalo y vuelve a intentar.${NC}" >&2
    echo "  Alternativa: copia .env.example a .env y completa los valores manualmente." >&2
    exit 1
  fi

  gen() { openssl rand -base64 "$1" | tr -d '\n'; }

  POSTGRES_PASSWORD=$(gen 24)
  DB_PASSWORD_AUTH=$(gen 24)
  DB_PASSWORD_USERS=$(gen 24)
  DB_PASSWORD_IMAGE=$(gen 24)
  JWT_SECRET=$(gen 48)
  MINIO_ROOT_PASSWORD=$(gen 24)
  REDIS_PASSWORD=$(gen 24)
  # Percent-encode para Flower (+ → %2B, / → %2F) — necesario porque Redis URL parsea mal esos chars
  REDIS_PASSWORD_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1],safe=''))" "$REDIS_PASSWORD" 2>/dev/null \
    || printf '%s' "$REDIS_PASSWORD" | sed 's/+/%2B/g; s|/|%2F|g')
  INTERNAL_TOKEN=$(gen 32)
  FLOWER_PASSWORD=$(gen 24)

  cat > "$ENV_FILE" << EOF
# ============================================================
# MIC EMASEO — Variables de entorno (GENERADO POR start.sh)
# Generado el $(date -u '+%Y-%m-%d %H:%M UTC')
# ⚠  NUNCA subas este archivo al repositorio.
# ============================================================

# ── PostgreSQL ────────────────────────────────────────────────────────────────
POSTGRES_USER=postgres
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=MIC-EMASEO

# ── Roles de servicio (mínimo privilegio) ─────────────────────────────────────
DB_USER_AUTH=auth_svc
DB_PASSWORD_AUTH=${DB_PASSWORD_AUTH}

DB_USER_USERS=users_svc
DB_PASSWORD_USERS=${DB_PASSWORD_USERS}

DB_USER_IMAGE=image_svc
DB_PASSWORD_IMAGE=${DB_PASSWORD_IMAGE}

# ── JWT ───────────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=15m

# ── MinIO (Object Storage S3-compatible) ──────────────────────────────────────
MINIO_ROOT_USER=emaseo_admin
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
S3_BUCKET=emaseo-incidents
S3_REGION=us-east-1
# Las imágenes se sirven a través del api-gateway (proxy interno a MinIO).
# Para celular/LAN: cambiar localhost por la IP de red de la máquina (ej. 192.168.1.X).
S3_PUBLIC_URL=http://localhost:4000/api/media

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}
# Versión percent-encoded para Flower (+ → %2B, / → %2F). No editar manualmente.
REDIS_PASSWORD_ENCODED=${REDIS_PASSWORD_ENCODED}

# ── SMTP — COMPLETAR MANUALMENTE ─────────────────────────────────────────────
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=notificaciones@emaseo.ec
SMTP_PASS=COMPLETAR_MANUALMENTE
EMAIL_FROM=notificaciones@emaseo.ec

# ── Seguridad interna ─────────────────────────────────────────────────────────
INTERNAL_TOKEN=${INTERNAL_TOKEN}

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173

# ── ML Service ────────────────────────────────────────────────────────────────
# true  = modo demo (sin modelo .pt) | false = inferencia real
DUMMY_MODE=true

# ── Flower (dashboard Celery) ─────────────────────────────────────────────────
FLOWER_USER=admin
FLOWER_PASSWORD=${FLOWER_PASSWORD}

# ── Puertos de administración (dev) ──────────────────────────────────────────
# true  = publica MinIO :9000/:9001, Redis :6379, Flower :5555 en 127.0.0.1
# vacío = sin publicación de puertos (producción)
EXPOSE_DEV_PORTS=
EOF

  echo -e "  ${GREEN}✓${NC} .env generado con secretos seguros."
  echo -e "  ${YELLOW}!  Recuerda completar SMTP_* en .env para habilitar correos de OTP.${NC}"
else
  echo -e "  ${GREEN}✓${NC} Usando .env existente."
fi

# Activar EXPOSE_DEV_PORTS si se pasó --dev
if [[ "$ENABLE_DEV_PORTS" == true ]]; then
  if grep -q "^EXPOSE_DEV_PORTS=" "$ENV_FILE"; then
    sed -i 's/^EXPOSE_DEV_PORTS=.*/EXPOSE_DEV_PORTS=true/' "$ENV_FILE"
  else
    echo "EXPOSE_DEV_PORTS=true" >> "$ENV_FILE"
  fi
  echo -e "  ${YELLOW}!  --dev activado: puertos de MinIO, Redis y Flower expuestos en 127.0.0.1${NC}"
fi

# Cargar variables del .env para usar en el script
# tr -d '\r' elimina CRLF de archivos generados en Windows antes de sourcear
set -a
# shellcheck disable=SC1090
source <(tr -d '\r' < "$ENV_FILE")
set +a

# ── 3. Construcción de imágenes ───────────────────────────────────────────────
echo ""
echo -e "${BLUE}[3/5]${NC} Construyendo imágenes Docker..."

if [[ "$DO_BUILD" == false ]]; then
  echo -e "  ${YELLOW}⊘  --no-build: saltando construcción.${NC}"
elif [[ "$FORCE_BUILD" == true ]]; then
  echo "  Construcción forzada con --pull (puede tardar varios minutos)..."
  docker compose -f "$COMPOSE_FILE" build --pull
  echo -e "  ${GREEN}✓${NC} Imágenes construidas."
else
  echo "  Construyendo imágenes (solo las que cambiaron)..."
  docker compose -f "$COMPOSE_FILE" build
  echo -e "  ${GREEN}✓${NC} Imágenes listas."
fi

# ── 4. Arrancar los contenedores ──────────────────────────────────────────────
echo ""
echo -e "${BLUE}[4/5]${NC} Levantando los 11 contenedores..."
docker compose -f "$COMPOSE_FILE" up -d
echo -e "  ${GREEN}✓${NC} Contenedores iniciados."

# ── 5. Esperar a que todos los servicios estén healthy ────────────────────────
echo ""
echo -e "${BLUE}[5/5]${NC} Esperando a que los servicios estén listos..."

# Servicios que deben reportar "healthy" (en el orden en que suelen arrancar)
HEALTHY_SERVICES=("emaseo-postgres" "emaseo-minio" "emaseo-redis" "emaseo-auth" "emaseo-users" "emaseo-image" "emaseo-gateway" "emaseo-ml-api")
MAX_WAIT=300  # segundos máximos de espera total
INTERVAL=5
ELAPSED=0

all_healthy() {
  for svc in "${HEALTHY_SERVICES[@]}"; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "missing")
    if [[ "$STATUS" != "healthy" ]]; then
      return 1
    fi
  done
  return 0
}

# Progreso visual
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPIN_IDX=0

while ! all_healthy; do
  if [[ $ELAPSED -ge $MAX_WAIT ]]; then
    echo ""
    echo -e "${RED}ERROR: Tiempo de espera agotado (${MAX_WAIT}s). Algún servicio no arrancó.${NC}" >&2
    echo ""
    echo "Estado actual:"
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "Revisa los logs del servicio problemático:"
    echo "  docker compose logs -f <nombre-del-servicio>"
    exit 1
  fi

  # Mostrar qué servicios faltan
  PENDING=()
  for svc in "${HEALTHY_SERVICES[@]}"; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "missing")
    if [[ "$STATUS" != "healthy" ]]; then
      PENDING+=("$svc($STATUS)")
    fi
  done

  printf "\r  ${SPINNER[$SPIN_IDX]} Esperando: %s (%ds/%ds)   " "${PENDING[*]}" "$ELAPSED" "$MAX_WAIT"
  SPIN_IDX=$(( (SPIN_IDX + 1) % ${#SPINNER[@]} ))
  sleep $INTERVAL
  ELAPSED=$(( ELAPSED + INTERVAL ))
done

echo -e "\r  ${GREEN}✓${NC} Todos los servicios están listos.                              "

# ── URLs de acceso ────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Sistema MIC EMASEO en línea${NC}"
echo -e "${CYAN}${BOLD}════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}API Gateway:${NC}   http://localhost:4000"
echo -e "  ${BOLD}Swagger UI:${NC}    http://localhost:4000/api-docs"

EXPOSE_DEV=$(grep -oP '(?<=^EXPOSE_DEV_PORTS=).+' "$ENV_FILE" 2>/dev/null || echo "")
if [[ -n "$EXPOSE_DEV" ]]; then
  echo ""
  echo -e "  ${BOLD}MinIO Console:${NC} http://localhost:9001"
  echo -e "  ${BOLD}Flower:${NC}        http://localhost:5555"
  echo -e "  ${BOLD}ML Swagger:${NC}    http://localhost:8000/docs"
  echo ""
  echo -e "  ${YELLOW}Credenciales MinIO:${NC} ${MINIO_ROOT_USER:-emaseo_admin} / (ver .env → MINIO_ROOT_PASSWORD)"
  echo -e "  ${YELLOW}Credenciales Flower:${NC} ${FLOWER_USER:-admin} / (ver .env → FLOWER_PASSWORD)"
else
  echo ""
  echo -e "  ${YELLOW}ℹ  MinIO, Redis y Flower no están expuestos al host.${NC}"
  echo -e "  ${YELLOW}   Usa ${BOLD}bash start.sh --dev${YELLOW} o ${BOLD}EXPOSE_DEV_PORTS=true${YELLOW} en .env para acceder.${NC}"
fi

echo ""
DUMMY=$(grep -oP '(?<=^DUMMY_MODE=).+' "$ENV_FILE" 2>/dev/null || echo "false")
if [[ "$DUMMY" == "true" ]]; then
  echo -e "  ${YELLOW}⚠  ML Service en MODO DUMMY — no requiere modelo .pt${NC}"
  echo -e "  ${YELLOW}   Para inferencia real: DUMMY_MODE=false + ML/modelos/rtdetr_l_best.pt${NC}"
else
  echo -e "  ${GREEN}✓  ML Service con inferencia real (RT-DETR-L v2)${NC}"
fi

echo ""
echo -e "  ${BOLD}Verificar estado:${NC}  docker compose ps"
echo -e "  ${BOLD}Ver logs:${NC}          docker compose logs -f api-gateway"
echo -e "  ${BOLD}Apagar:${NC}            docker compose down"
echo ""
