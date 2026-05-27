#!/bin/bash
# =============================================================================
# scripts/generate_env.sh
# Genera un .env con secretos seguros para desarrollo local.
#
# Uso:
#   bash scripts/generate_env.sh
#
# El script crea (o sobreescribe) el archivo .env en la raíz del proyecto.
# Requiere: openssl (disponible en Linux, macOS y WSL).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

# ── Verificar que openssl esté disponible ─────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl no está instalado. Instálalo y vuelve a intentar." >&2
  exit 1
fi

# ── Preservar SMTP / EMAIL_FROM del .env existente si lo hay ─────────────────
preserve() {
  local key="$1" default="$2"
  if [[ -f "$ENV_FILE" ]]; then
    local val
    val="$(grep -E "^${key}=" "$ENV_FILE" | sed -E "s/^${key}=//" | head -n1)"
    if [[ -n "$val" && "$val" != "COMPLETAR_MANUALMENTE" ]]; then
      printf "%s" "$val"
      return
    fi
  fi
  printf "%s" "$default"
}

SMTP_HOST_VAL="$(preserve SMTP_HOST 'smtp.tudominio.com')"
SMTP_PORT_VAL="$(preserve SMTP_PORT '587')"
SMTP_USER_VAL="$(preserve SMTP_USER 'notificaciones@emaseo.ec')"
SMTP_PASS_VAL="$(preserve SMTP_PASS 'COMPLETAR_MANUALMENTE')"
EMAIL_FROM_VAL="$(preserve EMAIL_FROM 'notificaciones@emaseo.ec')"

# ── Prevenir sobreescritura accidental en producción ─────────────────────────
if [[ -f "$ENV_FILE" && $FORCE -eq 0 ]]; then
  echo "⚠  Ya existe un archivo .env en $ENV_FILE"
  read -rp "   ¿Sobreescribir? [s/N] " respuesta
  [[ "${respuesta,,}" == "s" ]] || { echo "Cancelado."; exit 0; }
fi

gen() { openssl rand -base64 "$1" | tr -d '\n'; }

# URL-encode los caracteres conflictivos de base64 ('+', '/', '=') para usar
# la contraseña en URLs (redis://:<pass>@host:6379/0) sin romper el parser.
urlenc() { printf '%s' "$1" | sed -e 's/+/%2B/g' -e 's/\//%2F/g' -e 's/=/%3D/g'; }

echo "Generando secretos seguros..."

POSTGRES_PASSWORD=$(gen 24)
DB_PASSWORD_AUTH=$(gen 24)
DB_PASSWORD_USERS=$(gen 24)
DB_PASSWORD_IMAGE=$(gen 24)
JWT_SECRET=$(gen 48)
MINIO_ROOT_PASSWORD=$(gen 24)
REDIS_PASSWORD=$(gen 24)
REDIS_PASSWORD_ENCODED=$(urlenc "$REDIS_PASSWORD")
INTERNAL_TOKEN=$(gen 32)
FLOWER_PASSWORD=$(gen 24)

cat > "$ENV_FILE" << EOF
# ============================================================
# MIC EMASEO — Variables de entorno (GENERADO AUTOMÁTICAMENTE)
# Archivo generado el $(date -u '+%Y-%m-%d %H:%M UTC')
# ⚠  NUNCA subas este archivo al repositorio.
# ============================================================

# ── PostgreSQL (superusuario del contenedor) ──────────────────────────────────
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

# Coste de bcrypt para hashing de contraseñas. 12 es el mínimo recomendado.
BCRYPT_ROUNDS=12

# ── Postgres SSL ──────────────────────────────────────────────────────────────
# Dejar en false con Postgres en docker local. Cambiar a true con Supabase/RDS.
DB_SSL=false

# ── MinIO (Object Storage S3-compatible) ──────────────────────────────────────
MINIO_ROOT_USER=emaseo_admin
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
S3_BUCKET=emaseo-incidents
S3_REGION=us-east-1
S3_PUBLIC_URL=http://localhost:4000/api/media

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}
# REDIS_PASSWORD_ENCODED: usado en URLs (Celery, rate-limit-redis, Flower).
# Es REDIS_PASSWORD con + → %2B, / → %2F, = → %3D para que el parser de URL no rompa.
REDIS_PASSWORD_ENCODED=${REDIS_PASSWORD_ENCODED}

# ── SMTP (envío de correos transaccionales) ───────────────────────────────────
SMTP_HOST=${SMTP_HOST_VAL}
SMTP_PORT=${SMTP_PORT_VAL}
SMTP_USER=${SMTP_USER_VAL}
SMTP_PASS=${SMTP_PASS_VAL}
EMAIL_FROM=${EMAIL_FROM_VAL}

# ── Seguridad interna (X-Internal-Token) ─────────────────────────────────────
INTERNAL_TOKEN=${INTERNAL_TOKEN}

# ── CORS (API Gateway) ────────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173,http://localhost:4000

# ── ML Service ────────────────────────────────────────────────────────────────
DUMMY_MODE=false

# ── Flower (dashboard Celery) ─────────────────────────────────────────────────
FLOWER_USER=admin
FLOWER_PASSWORD=${FLOWER_PASSWORD}

# ── Puertos de desarrollo ─────────────────────────────────────────────────────
# Vacío = puertos de MinIO, Redis y Flower NO publicados en el host (producción).
# Cambiar a "true" para acceso local con mc, redis-cli, RedisInsight, etc.
EXPOSE_DEV_PORTS=
EOF

echo ""
echo "✓ .env creado en: $ENV_FILE"
echo ""
if [[ "$SMTP_PASS_VAL" == "COMPLETAR_MANUALMENTE" ]]; then
  echo "Pendiente de completar manualmente:"
  echo "  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM"
  echo ""
fi
echo "⚠  Recuerda: si ya existe el volumen postgres_data, destruye y recrea"
echo "   el contenedor para que el nuevo POSTGRES_PASSWORD tome efecto:"
echo "     docker compose down -v && docker compose up -d"
