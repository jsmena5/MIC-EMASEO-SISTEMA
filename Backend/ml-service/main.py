"""
Microservicio de inferencia RT-DETR-L para EMASEO — v2 (async)
Puerto: 8000

El modelo vive en el Celery Worker, no aquí.
Este proceso solo persiste la imagen en disco y despacha la ruta al worker.
"""

import asyncio
import base64
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from celery.result import AsyncResult
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from celery_app import celery
from tasks import run_inference

DUMMY_MODE = os.environ.get("DUMMY_MODE", "true")
UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", "/app/uploads"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="EMASEO ML Service", version="2.0.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    image_base64: str
    image_width: int = 1280
    image_height: int = 960


# ── Helpers síncronos — se ejecutan en el thread pool de asyncio ──────────────

def _save_and_enqueue(
    image_b64: str, image_path: Path, task_id: str, width: int, height: int
) -> None:
    """Decode base64 + escritura en volumen compartido + enqueue del path en Redis.
    Redis nunca toca bytes de imagen — solo un string de ~60 caracteres."""
    image_path.write_bytes(base64.b64decode(image_b64))
    run_inference.apply_async(
        args=[str(image_path), width, height],
        task_id=task_id,
    )


def _check_broker() -> str:
    try:
        celery.control.inspect(timeout=1).active()
        return "ok"
    except Exception:
        return "degraded"


def _poll_task(task_id: str) -> tuple[str, object]:
    result = AsyncResult(task_id, app=celery)
    state = result.state
    if state == "SUCCESS":
        return state, result.get(propagate=False)
    if state == "FAILURE":
        return state, str(result.info)
    return state, None


# ── Endpoints async — el event loop de uvicorn nunca se bloquea ───────────────

@app.get("/health")
async def health():
    broker_status = await asyncio.to_thread(_check_broker)
    return {
        "status": "ok",
        "broker": broker_status,
        "dummy_mode": DUMMY_MODE,
        "uploads_dir": str(UPLOADS_DIR),
    }


@app.post("/predict", status_code=202)
async def predict(req: PredictRequest):
    """Encola la tarea de inferencia y devuelve task_id inmediatamente."""
    task_id = str(uuid.uuid4())
    image_path = UPLOADS_DIR / f"{task_id}.jpg"

    await asyncio.to_thread(
        _save_and_enqueue,
        req.image_base64, image_path, task_id, req.image_width, req.image_height,
    )
    return {"task_id": task_id, "status": "queued"}


@app.get("/predict/status/{task_id}")
async def predict_status(task_id: str):
    """Polling del resultado. El cliente llama cada ~1 s hasta status='completed'."""
    state, data = await asyncio.to_thread(_poll_task, task_id)

    if state == "PENDING":
        return {"task_id": task_id, "status": "pending",    "result": None}
    if state == "STARTED":
        return {"task_id": task_id, "status": "processing", "result": None}
    if state == "SUCCESS":
        return {"task_id": task_id, "status": "completed",  "result": data}
    if state == "FAILURE":
        return JSONResponse(
            status_code=500,
            content={"task_id": task_id, "status": "failed", "error": data},
        )
    return {"task_id": task_id, "status": state.lower(), "result": None}
