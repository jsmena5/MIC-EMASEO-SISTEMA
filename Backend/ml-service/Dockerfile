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
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=120 -r requirements.txt

COPY celery_app.py tasks.py main.py gunicorn.conf.py config_classes.py ml_utils.py semantic_gate.py ./
COPY tests/ ./tests/
COPY scripts/ ./scripts/

RUN pip install --no-cache-dir "pytest>=8.0.0" \
    && mkdir -p /app/uploads /app/torch_cache /app/hf_cache \
    && python scripts/warmup_midas.py \
    && python scripts/warmup_clip.py \
    && groupadd --gid 1001 appgroup \
    && useradd --uid 1001 --gid 1001 --no-create-home --shell /bin/false appuser \
    && chown -R appuser:appgroup /app

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Default: API con Gunicorn+Uvicorn workers (el worker ML sobreescribe en docker-compose)
CMD ["gunicorn", "main:app", "-c", "gunicorn.conf.py"]
