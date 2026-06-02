"""
Microservicio de inferencia RT-DETR-L para EMASEO — v2 (async)
Puerto: 8000

El modelo vive en el Celery Worker, no aquí.
Este proceso solo persiste la imagen en disco y despacha la ruta al worker.
"""

import asyncio
import base64
import logging
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

logger = logging.getLogger(__name__)

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
    # Pre-carga CLIP al arrancar (con preload_app=True en gunicorn, esto ocurre
    # en el proceso padre antes del fork → todos los workers comparten el modelo
    # por copy-on-write en lugar de cada uno cargar su propia copia ~400 MB).
    from semantic_gate import warm_up_clip
    warm_up_clip()
    yield


app = FastAPI(title="EMASEO ML Service", version="2.0.0", lifespan=lifespan)


class PredictRequest(BaseModel):
    image_base64: str
    image_width: int = 1280
    image_height: int = 960
    client_coverage_ratio: float | None = None


class PreCheckRequest(BaseModel):
    image_base64: str
    image_width:  int = 320
    image_height: int = 240
    guidance_mode: bool = False


# ── Helpers síncronos — se ejecutan en el thread pool de asyncio ──────────────

def _save_and_enqueue(
    image_b64: str, image_path: Path, task_id: str, width: int, height: int,
    client_coverage_ratio: float | None = None,
) -> None:
    """Decode base64 + escritura en volumen compartido + enqueue del path en Redis.
    Redis nunca toca bytes de imagen — solo un string de ~60 caracteres."""
    image_path.write_bytes(base64.b64decode(image_b64))
    kwargs = {}
    if client_coverage_ratio is not None:
        kwargs["client_coverage_ratio"] = client_coverage_ratio
    run_inference.apply_async(
        args=[str(image_path), width, height],
        kwargs=kwargs,
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


@app.post("/pre-check")
async def pre_check(req: PreCheckRequest):
    """Pre-screening liviano — sin Celery, sin YOLO. Responde en <200 ms.

    Calcula compute_garbage_score() sobre el frame completo (pseudo-detección
    que cubre toda la imagen) y devuelve si la imagen parece basura real o no.

    Threshold por defecto 0.35 (subido de 0.25): más estricto para reducir
    falsos positivos de objetos personales lisos (mochila, funda, laptop) que
    el modelo YOLO tiende a confundir con basura. El cliente hace fail-closed
    sobre este endpoint, así que un 5xx aquí bloquea el envío en lugar de
    dejarlo pasar (fail-open ya no es viable).
    """
    threshold = float(os.environ.get("PRE_CHECK_THRESHOLD", "0.35"))

    # En DUMMY_MODE simular resultado positivo — no altera el flujo de desarrollo
    if DUMMY_MODE == "true":
        base_resp = {"garbage_score": 0.72, "is_garbage": True, "threshold": threshold}
        if req.guidance_mode:
            base_resp["coverage_ratio"] = 0.45
            base_resp["distance_hint"]  = "OPTIMAL"
        return base_resp

    def _run(b64: str, guidance: bool) -> dict:
        import io
        import base64 as _b64
        from PIL import Image as PILImage
        from ml_utils import compute_garbage_score, estimate_coverage_fast, coverage_to_distance_hint
        img = PILImage.open(io.BytesIO(_b64.b64decode(b64))).convert("RGB")
        w, h = img.size
        # Pseudo-detección que cubre todo el frame → analiza la imagen completa
        score = compute_garbage_score(img, [{"bbox": [0, 0, w, h]}], w, h)
        result = {"score": score}
        if guidance:
            cov = estimate_coverage_fast(img)
            result["coverage_ratio"] = cov
            result["distance_hint"]  = coverage_to_distance_hint(cov)
        return result

    try:
        data = await asyncio.to_thread(_run, req.image_base64, req.guidance_mode)
    except Exception as exc:
        logger.warning("[pre-check] error computing garbage_score: %s", exc)
        # 5xx → cliente lanza Alert "Sin conexión al validador" → bloquea envío
        return JSONResponse(
            status_code=500,
            content={"error": "pre_check_failed", "detail": str(exc)},
        )

    score = data["score"]
    response: dict = {
        "garbage_score": round(score, 4),
        "is_garbage":    score >= threshold,
        "threshold":     threshold,
    }
    if req.guidance_mode:
        response["coverage_ratio"] = data["coverage_ratio"]
        response["distance_hint"]  = data["distance_hint"]
    return response


@app.post("/predict", status_code=202)
async def predict(req: PredictRequest):
    """Encola la tarea de inferencia y devuelve task_id inmediatamente."""
    task_id = str(uuid.uuid4())
    image_path = UPLOADS_DIR / f"{task_id}.jpg"

    await asyncio.to_thread(
        _save_and_enqueue,
        req.image_base64, image_path, task_id, req.image_width, req.image_height,
        req.client_coverage_ratio,
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
