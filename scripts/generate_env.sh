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

# ── Verificar que openssl esté disponible ─────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl no está instalado. Instálalo y vuelve a intentar." >&2
  exit 1
fi

# ── Prevenir sobreescritura accidental en producción ─────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  echo "⚠  Ya existe un archivo .env en $ENV_FILE"
  read -rp "   ¿Sobreescribir? [s/N] " respuesta
  [[ "${respuesta,,}" == "s" ]] || { echo "Cancelado."; exit 0; }
fi

gen() { openssl rand -base64 "$1" | tr -d '\n'; }

echo "Generando secretos seguros..."

POSTGRES_PASSWORD=$(gen 24)
DB_PASSWORD_AUTH=$(gen 24)
DB_PASSWORD_USERS=$(gen 24)
DB_PASSWORD_IMAGE=$(gen 24)
JWT_SECRET=$(gen 48)
MINIO_ROOT_PASSWORD=$(gen 24)
REDIS_PASSWORD=$(gen 24)
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

# ── MinIO (Object Storage S3-compatible) ──────────────────────────────────────
MINIO_ROOT_USER=emaseo_admin
MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
S3_BUCKET=emaseo-incidents
S3_REGION=us-east-1
S3_PUBLIC_URL=http://localhost:9000

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}

# ── SMTP (envío de correos transaccionales) ───────────────────────────────────
# Completar manualmente con las credenciales SMTP reales.
SMTP_HOST=smtp.tudominio.com
SMTP_PORT=587
SMTP_USER=notificaciones@emaseo.ec
SMTP_PASS=COMPLETAR_MANUALMENTE
EMAIL_FROM=notificaciones@emaseo.ec

# ── Seguridad interna (X-Internal-Token) ─────────────────────────────────────
INTERNAL_TOKEN=${INTERNAL_TOKEN}

# ── CORS (API Gateway) ────────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173

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
echo "Pendiente de completar manualmente:"
echo "  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM"
echo ""
echo "⚠  Recuerda: si ya existe el volumen postgres_data, destruye y recrea"
echo "   el contenedor para que el nuevo POSTGRES_PASSWORD tome efecto:"
echo "     docker compose down -v && docker compose up -d"
