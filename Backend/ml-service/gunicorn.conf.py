import multiprocessing
import os

# ── Binding ───────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"

# ── Worker class: Uvicorn async dentro de Gunicorn (ASGI + multiprocess) ─────
worker_class = "uvicorn.workers.UvicornWorker"

# ── Workers ───────────────────────────────────────────────────────────────────
# CLIP (ViT-B/32) ocupa ~400 MB por proceso. Sin preload_app, cada worker carga
# su propia copia → en un VPS con 2-4 cores y workers=cpu*2+1 se agotan 2-4 GB
# solo en modelos ML, lo que causa timeouts en el pre-check.
# Con preload_app=True el modelo se carga UNA vez en el proceso padre y los
# workers lo heredan por copy-on-write → ~400 MB totales en vez de N×400 MB.
# Default conservador de 2 para VPS pequeños; sobreescribible con GUNICORN_WORKERS.
workers = int(os.environ.get("GUNICORN_WORKERS", 2))

# ── Preload: carga la app (y CLIP) antes de forkear workers ──────────────────
# Requisito para que el copy-on-write de CLIP funcione. Sin esto cada worker
# importa el módulo de nuevo y carga su propia copia del modelo.
preload_app = True

# ── Timeouts ──────────────────────────────────────────────────────────────────
timeout = 120
keepalive = 5
graceful_timeout = 30

# ── Reciclaje de workers: previene memory leaks en procesos de larga duración ─
max_requests = 1000
max_requests_jitter = 100

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog = "-"
errorlog  = "-"
loglevel  = os.environ.get("GUNICORN_LOG_LEVEL", "info")
