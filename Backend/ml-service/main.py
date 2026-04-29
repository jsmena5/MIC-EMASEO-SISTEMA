"""
Microservicio de inferencia RT-DETR-L para EMASEO — v2 (async)
Puerto: 8000

El modelo vive en el Celery Worker, no aquí.
Este proceso solo persiste la imagen en disco y despacha la ruta al worker.
"""

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


@app.get("/health")
def health():
    try:
        celery.control.inspect(timeout=1).active()
        broker_status = "ok"
    except Exception:
        broker_status = "degraded"
    return {
        "status": "ok",
        "broker": broker_status,
        "dummy_mode": DUMMY_MODE,
        "uploads_dir": str(UPLOADS_DIR),
    }


@app.post("/predict", status_code=202)
def predict(req: PredictRequest):
    """Persiste la imagen en el volumen compartido y encola solo la ruta.
    Redis nunca toca bytes de imagen — solo un string de ~60 caracteres."""
    task_id = str(uuid.uuid4())
    image_path = UPLOADS_DIR / f"{task_id}.jpg"
    image_path.write_bytes(base64.b64decode(req.image_base64))

    run_inference.apply_async(
        args=[str(image_path), req.image_width, req.image_height],
        task_id=task_id,
    )
    return {"task_id": task_id, "status": "queued"}


@app.get("/predict/status/{task_id}")
def predict_status(task_id: str):
    """Polling del resultado. El cliente llama cada ~1 s hasta status='completed'."""
    result = AsyncResult(task_id, app=celery)
    state = result.state

    if state == "PENDING":
        return {"task_id": task_id, "status": "pending",    "result": None}
    if state == "STARTED":
        return {"task_id": task_id, "status": "processing", "result": None}
    if state == "SUCCESS":
        return {"task_id": task_id, "status": "completed",  "result": result.get()}
    if state == "FAILURE":
        return JSONResponse(
            status_code=500,
            content={"task_id": task_id, "status": "failed",
                     "error": str(result.info)},
        )
    return {"task_id": task_id, "status": state.lower(), "result": None}
