"""
grpc_server.py

Servidor gRPC del ml-service (puerto 50051).
Expone dos RPCs:
  · Predict       — Encola la tarea de inferencia vía Celery, devuelve task_id.
  · PredictStatus — Consulta el estado de una tarea Celery.

La diferencia clave con la API HTTP previa es que el cliente (image-service) ya
NO envía la imagen en Base64. En su lugar envía la s3_key donde la imagen ya fue
subida. El worker de Celery (tasks.py) la descarga directamente desde S3.

Esto elimina el cuello de botella principal de latencia: transferir ~10 MB de
Base64 en JSON por la red interna.
"""

import asyncio
import json
import logging
import os
import sys
from concurrent import futures
from pathlib import Path

import grpc
from celery.result import AsyncResult

from celery_app import celery
from tasks import run_inference_from_s3

logger = logging.getLogger(__name__)

GRPC_PORT = int(os.environ.get("GRPC_PORT", "50051"))

# ── Importar stubs generados ──────────────────────────────────────────────────
# Se generan con: python -m grpc_tools.protoc ...
# Ver scripts/gen_proto.sh
try:
    import ml_service_pb2
    import ml_service_pb2_grpc
except ImportError:
    logger.critical(
        "[grpc_server] Stubs gRPC no encontrados. "
        "Ejecuta scripts/gen_proto.sh para generarlos."
    )
    sys.exit(1)


# ── Implementación del servicer ───────────────────────────────────────────────

class MLServiceServicer(ml_service_pb2_grpc.MLServiceServicer):
    """Implementación del servicio MLService definido en ml_service.proto."""

    def Predict(self, request, context):
        """
        Encola una tarea de inferencia en Celery y devuelve el task_id.
        
        El request contiene s3_key (e.g. 'incidents/abc.jpg') en lugar de
        la imagen en Base64, lo que elimina el mayor cuello de botella de red.
        """
        import uuid
        task_id = str(uuid.uuid4())

        kwargs = {}
        if request.HasField("client_coverage_ratio"):
            kwargs["client_coverage_ratio"] = request.client_coverage_ratio

        try:
            run_inference_from_s3.apply_async(
                args=[request.s3_key, request.image_width, request.image_height],
                kwargs=kwargs,
                task_id=task_id,
            )
            logger.info(
                "[grpc] Predict encolado: task_id=%s s3_key=%s",
                task_id, request.s3_key,
            )
            return ml_service_pb2.PredictResponse(task_id=task_id, status="queued")
        except Exception as exc:
            logger.error("[grpc] Error al encolar tarea: %s", exc)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(exc))
            return ml_service_pb2.PredictResponse()

    def PredictStatus(self, request, context):
        """
        Consulta el estado de una tarea Celery.
        Devuelve status + result_json cuando está completada.
        """
        try:
            result = AsyncResult(request.task_id, app=celery)
            state = result.state

            if state == "SUCCESS":
                data = result.get(propagate=False)
                return ml_service_pb2.PredictStatusResponse(
                    task_id=request.task_id,
                    status="completed",
                    result_json=json.dumps(data, ensure_ascii=False),
                )
            if state == "FAILURE":
                return ml_service_pb2.PredictStatusResponse(
                    task_id=request.task_id,
                    status="failed",
                    error_message=str(result.info),
                )
            if state == "STARTED":
                status_str = "processing"
            else:
                status_str = state.lower()  # "pending", "retry", etc.

            return ml_service_pb2.PredictStatusResponse(
                task_id=request.task_id,
                status=status_str,
            )
        except Exception as exc:
            logger.error("[grpc] Error en PredictStatus task_id=%s: %s", request.task_id, exc)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(exc))
            return ml_service_pb2.PredictStatusResponse()


# ── Arranque ─────────────────────────────────────────────────────────────────

def serve():
    """Levanta el servidor gRPC bloqueante."""
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            # Límite de mensaje generoso — los resultados JSON pueden ser grandes.
            ("grpc.max_send_message_length",    10 * 1024 * 1024),
            ("grpc.max_receive_message_length", 10 * 1024 * 1024),
            # Keep-alive para detectar conexiones muertas rápido
            ("grpc.keepalive_time_ms", 30_000),
            ("grpc.keepalive_timeout_ms", 10_000),
        ],
    )
    ml_service_pb2_grpc.add_MLServiceServicer_to_server(MLServiceServicer(), server)
    server.add_insecure_port(f"[::]:{GRPC_PORT}")
    server.start()
    logger.info("[grpc] Servidor gRPC escuchando en puerto %d", GRPC_PORT)
    server.wait_for_termination()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    serve()
