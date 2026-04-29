import multiprocessing
import os

# ── Binding ───────────────────────────────────────────────────────────────────
bind = "0.0.0.0:8000"

# ── Worker class: Uvicorn async dentro de Gunicorn (ASGI + multiprocess) ─────
worker_class = "uvicorn.workers.UvicornWorker"

# ── Workers: (2 × cores) + 1 es el valor canónico para I/O-bound.
# La API solo persiste un archivo y encola un string → es puro I/O.
# Sobreescribible con GUNICORN_WORKERS=N en el entorno del contenedor.
workers = int(os.environ.get("GUNICORN_WORKERS", multiprocessing.cpu_count() * 2 + 1))

# ── Timeouts ──────────────────────────────────────────────────────────────────
# 120 s: margen generoso para escribir la imagen en disco bajo I/O pesado.
timeout = 120
# keepalive 5 s: reutiliza conexiones TCP — esencial bajo miles de requests.
keepalive = 5
graceful_timeout = 30

# ── Reciclaje de workers: previene memory leaks en procesos de larga duración ─
max_requests = 1000
max_requests_jitter = 100   # desface aleatorio para evitar reinicio simultáneo

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog = "-"   # stdout → capturado por Docker
errorlog  = "-"
loglevel  = os.environ.get("GUNICORN_LOG_LEVEL", "info")
