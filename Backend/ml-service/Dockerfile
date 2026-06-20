# Fase dummy (DUMMY_MODE=true): python:3.11-slim es suficiente.
# Cuando el modelo real esté listo, cambia la base por:
#   nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04
# y ajusta PATH para que use el Python del sistema.
FROM python:3.11-slim

WORKDIR /app

# ── Caches para modelos ────────────────────────────────────────────────────────
# MiDaS y modelos futuros vía torch.hub → TORCH_HOME
# CLIP (open-clip-torch) usa HuggingFace Hub → HF_HOME
# Configurar antes del pip install para que PyTorch/HF usen estos paths desde el inicio.
ENV TORCH_HOME=/app/torch_cache
ENV HF_HOME=/app/hf_cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt

COPY celery_app.py tasks.py main.py gunicorn.conf.py config_classes.py ml_utils.py semantic_gate.py grpc_server.py ./
COPY tests/ ./tests/
COPY scripts/ ./scripts/
# El .proto se copia junto al resto del código del servicio (ver gen_proto.sh).
# Si no existe, el build falla aquí con un mensaje claro en lugar de fallar en runtime.
COPY ml_service.proto ./ml_service.proto

# Generar stubs gRPC. grpc_server.py hace sys.exit(1) si no los encuentra.
RUN python -m grpc_tools.protoc \
      -I /app \
      --python_out=/app \
      --grpc_python_out=/app \
      /app/ml_service.proto

RUN pip install --no-cache-dir "pytest>=8.0.0" \
    && mkdir -p /app/uploads /app/torch_cache /app/hf_cache \
    && python scripts/warmup_midas.py \
    && python scripts/warmup_clip.py \
    && groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /bin/false appuser \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bash -c "curl -f http://localhost:8000/health && nc -z localhost 50051"

# Arranca gRPC y Gunicorn en paralelo.
# - trap propaga SIGTERM/SIGINT a ambos procesos (shutdown limpio de Docker).
# - Si el servidor gRPC muere (exit != 0), kill mata a Gunicorn y el
#   contenedor termina con código de error → Docker lo reinicia.
# - wait $GRPC_PID captura el exit code del gRPC después de que Gunicorn termina.
CMD ["bash", "-c", \
  "python grpc_server.py & GRPC_PID=$!; \
  trap 'kill $GRPC_PID 2>/dev/null' SIGTERM SIGINT; \
  gunicorn main:app -c gunicorn.conf.py & GUNICORN_PID=$!; \
  wait $GRPC_PID || (kill $GUNICORN_PID 2>/dev/null; exit 1); \
  wait $GUNICORN_PID"]
