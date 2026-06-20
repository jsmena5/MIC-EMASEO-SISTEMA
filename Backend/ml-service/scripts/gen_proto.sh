#!/usr/bin/env bash
# gen_proto.sh
#
# Genera los stubs Python desde el archivo .proto.
# Ejecutar desde la raíz del repositorio:
#   bash Backend/ml-service/scripts/gen_proto.sh
#
# Requisito: grpcio-tools instalado en el entorno activo.

set -euo pipefail

PROTO_SRC="Backend/proto/ml_service.proto"
OUT_DIR="Backend/ml-service"

echo "[gen_proto] Generando stubs desde ${PROTO_SRC} → ${OUT_DIR}"

python -m grpc_tools.protoc \
  -I Backend/proto \
  --python_out="${OUT_DIR}" \
  --grpc_python_out="${OUT_DIR}" \
  "${PROTO_SRC}"

echo "[gen_proto] ✓ Stubs generados:"
echo "  - ${OUT_DIR}/ml_service_pb2.py"
echo "  - ${OUT_DIR}/ml_service_pb2_grpc.py"
