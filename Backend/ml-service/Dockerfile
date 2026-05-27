# Fase dummy (DUMMY_MODE=true): python:3.11-slim es suficiente.
# Cuando el modelo real esté listo, cambia la base por:
#   nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04
# y ajusta PATH para que use el Python del sistema.
FROM python:3.11-slim

WORKDIR /app

# ── Cache para torch.hub ───────────────────────────────────────────────────────
# MiDaS y cualquier modelo futuro se almacenan aquí.
# Configurar antes del pip install para que PyTorch use este path desde el inicio.
ENV TORCH_HOME=/app/torch_cache

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt

COPY celery_app.py tasks.py main.py gunicorn.conf.py config_classes.py ml_utils.py ./
COPY tests/ ./tests/
COPY scripts/ ./scripts/

# pytest en capa separada: no invalida la caché de torch/ultralytics del RUN anterior
RUN pip install --no-cache-dir "pytest>=8.0.0"

# Directorios de datos (los volúmenes de producción los sobreescriben en runtime)
RUN mkdir -p /app/uploads /app/torch_cache

# ── Pre-descarga MiDaS en build-time ──────────────────────────────────────────
# Elimina la latencia de cold-start: el worker arranca con el modelo ya en caché.
# El modelo MiDaS_small (~15 MB) queda en /app/torch_cache dentro de la imagen.
# Falla silenciosamente si no hay red (build offline) → se descargará en runtime.
RUN python - <<'EOF'
import os, sys
try:
    import torch
    torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True, verbose=False)
    torch.hub.load("intel-isl/MiDaS", "transforms",  trust_repo=True, verbose=False)
    cache = os.environ.get("TORCH_HOME", "~/.cache/torch")
    print(f"[build] MiDaS pre-descargado en {cache}", flush=True)
except Exception as e:
    print(f"[build] MiDaS offline ({e}) — se descargará en el primer uso", file=sys.stderr, flush=True)
EOF

RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid 1001 --no-create-home --shell /bin/false appuser && \
    chown -R appuser:appgroup /app

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Default: API con Gunicorn+Uvicorn workers (el worker ML sobreescribe en docker-compose)
CMD ["gunicorn", "main:app", "-c", "gunicorn.conf.py"]
