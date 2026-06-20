#!/usr/bin/env bash
# sync_proto.sh
#
# Sincroniza el .proto fuente a los build contexts de cada servicio.
# Ejecutar desde la raíz del repositorio cada vez que ml_service.proto cambie.
#
# Uso: bash scripts/sync_proto.sh

set -euo pipefail

SRC="Backend/proto/ml_service.proto"

DESTINATIONS=(
  "Backend/ml-service/ml_service.proto"
  "Backend/image-service/proto/ml_service.proto"
)

for DEST in "${DESTINATIONS[@]}"; do
  mkdir -p "$(dirname "$DEST")"
  cp "$SRC" "$DEST"
  echo "[sync_proto] $SRC → $DEST"
done

echo "[sync_proto] Listo. Recuerda hacer commit de los 3 archivos."
