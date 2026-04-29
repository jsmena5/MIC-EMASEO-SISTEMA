import os
from celery import Celery

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

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
    # ── Defensa de VRAM: 1 proceso por contenedor, sin pre-fetch anticipado ─────
    worker_concurrency=1,           # 1 slot de ejecución — protege los 6 GB de VRAM
    worker_prefetch_multiplier=1,   # Redis NO pre-asigna tareas a un worker ocupado
    # ── Confiabilidad ante caídas ────────────────────────────────────────────────
    task_acks_late=True,            # ACK post-ejecución: caída del worker → re-encola
    task_track_started=True,        # habilita estado STARTED para polling del cliente
    task_reject_on_worker_lost=True,# tarea NACK si el worker muere a mitad de inferencia
    # ── Higiene de Redis: evitar acumulación de resultados ───────────────────────
    result_expires=3600,            # resultados se borran de Redis después de 1 hora
)
