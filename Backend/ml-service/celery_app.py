import os
from urllib.parse import quote
from celery import Celery
from kombu import Queue

# ── Construir la URL de Redis con password correctamente percent-encoded ──────
# Las contraseñas generadas con openssl base64 contienen '+', '/' y '=' que
# son caracteres especiales en URLs. Si se insertan sin escapar en
# redis://:PASSWORD@host:port/db, el parser de urllib corta el netloc en la
# primera '/' y trata el resto de la contraseña como path → ValueError: Port
# could not be cast to integer.
#
# Solución: pasar REDIS_PASSWORD por separado y construir la URL aquí con
# quote(password, safe=''), que convierte '/' → '%2F', '+' → '%2B', etc.
_password = os.environ.get("REDIS_PASSWORD", "")
_host     = os.environ.get("REDIS_HOST",     "redis")
_port     = os.environ.get("REDIS_PORT",     "6379")
_db       = os.environ.get("REDIS_DB",       "0")

if _password:
    REDIS_URL = f"redis://:{quote(_password, safe='')}@{_host}:{_port}/{_db}"
else:
    # Sin contraseña (entornos de prueba locales sin auth)
    REDIS_URL = f"redis://{_host}:{_port}/{_db}"

celery = Celery(
    "ml_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["tasks"],
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # ── Concurrencia: 1 inferencia a la vez con OMP_NUM_THREADS=3 ───────────────
    # En CPU-only, CLIP encode_image tarda 60-90s con 2 workers compitiendo por
    # los mismos cores. Con concurrency=1 y OMP=3 baja a ~3-5s por inferencia.
    # El --concurrency del comando de arranque sobreescribe este valor si difieren.
    worker_concurrency=1,
    worker_prefetch_multiplier=1,   # Redis NO pre-asigna tareas a un worker ocupado
    # ── Confiabilidad ante caídas ────────────────────────────────────────────────
    task_acks_late=True,            # ACK post-ejecución: caída del worker → re-encola
    task_track_started=True,        # habilita estado STARTED para polling del cliente
    task_reject_on_worker_lost=True,# tarea NACK si el worker muere a mitad de inferencia
    # ── Higiene de Redis: evitar acumulación de resultados ───────────────────────
    result_expires=3600,            # resultados se borran de Redis después de 1 hora
    # ── Timeouts: evitar inferencias colgadas que nunca entran al path de reintentos
    task_soft_time_limit=300,       # 5 min → SoftTimeLimitExceeded (limpieza graceful)
    task_time_limit=360,            # 6 min → SIGKILL si no respondió al soft limit
    # ── Colas: ml_queue (inferencia) + dead_letter (fallos definitivos) ──────────
    task_queues=(
        Queue("ml_queue"),
        Queue("dead_letter"),
    ),
    task_default_queue="ml_queue",
    task_routes={
        "ml_worker.run_inference":         {"queue": "ml_queue"},
        "ml_worker.run_inference_from_s3": {"queue": "ml_queue"},
        "ml_worker.warmup_clip":           {"queue": "ml_queue"},
        "ml_worker.handle_dead_letter":    {"queue": "dead_letter"},
    },
)
