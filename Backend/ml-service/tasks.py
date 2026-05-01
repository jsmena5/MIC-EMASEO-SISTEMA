import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import signals
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from celery_app import celery
from config_classes import ALIAS_MAP, CLASS_WEIGHTS, VALID_ALIASES

logger = logging.getLogger(__name__)

DUMMY_MODE = os.environ.get("DUMMY_MODE", "true").lower() == "true"

# ── Bandas de severidad: (cov_min, cov_max, vol_min, vol_max, nivel, prioridad)
_BANDS = [
    (0.00, 0.15, 0.1,  0.5,  "BAJO",    "BAJA"),
    (0.15, 0.40, 0.5,  2.0,  "MEDIO",   "MEDIA"),
    (0.40, 0.70, 2.0,  5.0,  "ALTO",    "ALTA"),
    (0.70, 1.00, 5.0, 15.0,  "CRITICO", "CRITICA"),
]

# ── NMS / filtrado de detecciones ────────────────────────────────────────────
NMS_CONF            = 0.35   # confianza mínima para aceptar una detección (era 0.60)
NMS_IOU             = 0.50   # IoU máximo para NMS (supresión de duplicados, era 0.45)
MIN_BBOX_AREA_RATIO = 0.005  # bbox < 0.5 % del frame → descartado como ruido

# ── Factores base de clasificación ───────────────────────────────────────────
CONF_NORMALIZATION_BASELINE = 0.60  # confianza ≥ este valor → conf_factor = 1.0 (era 0.70)
DET_FACTOR_BASE             = 0.40  # piso del factor de detección (1 solo objeto)
DET_FACTOR_STEP             = 0.20  # incremento por cada detección adicional

# ── Corrección de ambigüedad de escala (falso positivo por acercamiento) ─────
# Activada cuando hay 1 objeto aislado Y su cobertura supera el umbral.
# Contraejemplo deseado: un acúmulo real grande con 1 solo bbox enorme NO debería
# disparar esto (su confianza y contexto visual serán diferentes al de un close-up).
ISOLATION_COVERAGE_THRESHOLD = 0.55  # coverage_ratio mínimo para activar la corrección
ISOLATION_DET_THRESHOLD      = 1     # máximo de detecciones para considerar "aislado"
ISOLATION_PENALTY            = 0.65  # multiplicador sobre effective_ratio

_model = None


def _retry_or_dlq(task, exc: Exception, payload: dict) -> None:
    """Reintenta la tarea con backoff exponencial (5s, 10s, 20s).

    Si se superan los max_retries, publica el payload en la Dead Letter Queue
    y re-lanza la excepción para que Celery marque la tarea como FAILURE.
    task.retry() ya lanza internamente — no usar 'raise task.retry(...)'.
    """
    backoff = 5 * (2 ** task.request.retries)  # 5s → 10s → 20s
    try:
        task.retry(exc=exc, countdown=backoff)
    except MaxRetriesExceededError:
        handle_dead_letter.apply_async(
            kwargs={
                "original_task":     task.name,
                "payload":           payload,
                "error":             str(exc),
                "error_type":        type(exc).__name__,
                "failed_at":         datetime.now(timezone.utc).isoformat(),
                "retries_attempted": task.request.retries,
            },
            queue="dead_letter",
        )
        raise  # Celery marca la tarea como FAILURE


def _persist_to_fallback_log(entry: dict) -> None:
    """Último recurso cuando incluso el handler DLQ falla: escribe en disco.

    El archivo .jsonl queda en el volumen compartido y puede usarse para replay manual.
    """
    log_path = Path(os.environ.get("UPLOADS_DIR", "/app/uploads")) / "dead_letter_fallback.jsonl"
    try:
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        logger.warning("[DLQ-FALLBACK] Payload escrito en disco: %s", log_path)
    except OSError as write_err:
        logger.critical(
            "[DLQ-FALLBACK] FALLO CRITICO — payload irrecuperable: %s | entry=%s",
            write_err, entry,
        )


def _get_model():
    global _model
    if _model is None:
        from pathlib import Path
        from ultralytics import RTDETR
        model_path = Path(os.environ.get("ML_MODEL_PATH", "/app/models/rtdetr_l_best.pt"))
        print(f"[worker] Cargando modelo desde: {model_path}")
        _model = RTDETR(str(model_path))
        print("[worker] Modelo listo.")
    return _model


@signals.worker_init.connect
def _preload_model_on_startup(**kwargs):
    """Pre-carga el modelo al arrancar el worker (no en el primer request).
    Garantiza que la VRAM esté ocupada antes de que llegue la primera tarea,
    eliminando la latencia de cold-start bajo carga."""
    if not DUMMY_MODE:
        _get_model()


@celery.task(
    bind=True,
    name="ml_worker.handle_dead_letter",
    queue="dead_letter",
    max_retries=5,
    default_retry_delay=30,
)
def handle_dead_letter(
    self,
    original_task: str,
    payload: dict,
    error: str,
    error_type: str,
    failed_at: str,
    retries_attempted: int,
) -> dict:
    """Persiste tareas que agotaron sus reintentos en la cola principal.

    Reintentos propios: hasta 5 con delay fijo de 30 s (cubre fallos transitorios
    de DB/red al escribir el registro).  Si agota sus propios reintentos, escribe
    en disco como último recurso para no perder el payload.

    En producción: reemplazar el logger.error por escritura en tabla
    'failed_tasks' de PostgreSQL y/o alerta Slack / PagerDuty.
    """
    entry = {
        "original_task":     original_task,
        "payload":           payload,
        "error":             error,
        "error_type":        error_type,
        "failed_at":         failed_at,
        "retries_attempted": retries_attempted,
    }
    try:
        # TODO: persistir en tabla 'failed_tasks' de PostgreSQL o enviar alerta
        logger.error(
            "[DLQ] Tarea muerta | task=%s error=%s:%s reintentos=%d/3 timestamp=%s payload=%s",
            original_task, error_type, error, retries_attempted, failed_at, payload,
        )
        return {"status": "logged", "original_task": original_task, "failed_at": failed_at}
    except Exception as exc:
        try:
            self.retry(exc=exc)
        except MaxRetriesExceededError:
            # Último recurso: disco — garantiza que el payload nunca se pierda
            _persist_to_fallback_log(entry)
            raise


@celery.task(
    bind=True,
    name="ml_worker.run_inference",
    max_retries=3,
    queue="ml_queue",
    soft_time_limit=300,  # 5 min: permite limpieza antes del SIGKILL
    time_limit=360,       # 6 min: fuerza terminación si soft_time_limit se ignoró
)
def run_inference(self, image_path: str, image_width: int = 1280, image_height: int = 960):
    if DUMMY_MODE:
        time.sleep(2)
        return {
            "success": True,
            "has_waste": True,
            "nivel_acumulacion": "MEDIO",
            "volumen_estimado_m3": 1.5,
            "prioridad": "MEDIA",
            "tipo_residuo": "MIXTO",
            "confianza": 0.87,
            "num_detecciones": 3,
            "coverage_ratio": 0.23,
            "detecciones": [
                {"class": "garbage", "confidence": 0.91, "bbox": [120, 80, 450, 320]},
                {"class": "garbage", "confidence": 0.85, "bbox": [500, 150, 780, 400]},
                {"class": "garbage", "confidence": 0.84, "bbox": [200, 300, 600, 550]},
            ],
            "scale_penalty_applied": False,
            "tiempo_inferencia_ms": 2000,
            "modelo_nombre": "dummy_model_v0",
        }

    # ── Inferencia real (activa cuando DUMMY_MODE=false y el .pt existe) ─────
    from collections import Counter
    from pathlib import Path

    from PIL import Image

    try:
        img = Image.open(image_path).convert("RGB")

        img_w, img_h = img.size
        img_area      = img_w * img_h
        min_bbox_area = img_area * MIN_BBOX_AREA_RATIO

        model   = _get_model()
        t_start = time.time()
        results = model.predict(img, conf=NMS_CONF, iou=NMS_IOU, verbose=False)
        tiempo_ms = int((time.time() - t_start) * 1000)

        detecciones, total_bbox_area = [], 0.0
        if results and len(results) > 0:
            boxes, names = results[0].boxes, results[0].names
            if boxes is not None and len(boxes) > 0:
                for box in boxes:
                    class_name = names[int(box.cls[0])]
                    if class_name.lower() not in VALID_ALIASES:
                        continue
                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    bbox_area = (x2 - x1) * (y2 - y1)
                    if bbox_area < min_bbox_area:
                        continue
                    total_bbox_area += bbox_area
                    detecciones.append({
                        "class":      class_name,
                        "confidence": round(float(box.conf[0]), 4),
                        "bbox":       [x1, y1, x2, y2],
                    })

        model_name = Path(os.environ.get("ML_MODEL_PATH", "rtdetr_l_best.pt")).name

        # Liberar espacio en el volumen compartido: el worker es el último consumidor
        try:
            Path(image_path).unlink(missing_ok=True)
        except OSError:
            pass

        if not detecciones:
            return {
                "success":              True,
                "has_waste":            False,
                "message":              "No se detectaron residuos válidos",
                "tiempo_inferencia_ms": tiempo_ms,
                "modelo_nombre":        model_name,
            }

        num_detecciones = len(detecciones)
        coverage_ratio  = round(min(total_bbox_area / img_area, 1.0), 4) if img_area > 0 else 0.0
        confianza       = round(sum(d["confidence"] for d in detecciones) / num_detecciones, 4)
        dominant_class  = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
        tipo_residuo    = ALIAS_MAP.get(dominant_class.lower(), "OTRO")

        # ── Paso 1: effective_ratio base ─────────────────────────────────────────
        conf_factor     = min(1.0, confianza / CONF_NORMALIZATION_BASELINE)
        det_factor      = min(1.0, DET_FACTOR_BASE + DET_FACTOR_STEP * num_detecciones)
        effective_ratio = coverage_ratio * conf_factor * det_factor

        # ── Paso 2: corrección de ambigüedad de escala ───────────────────────────
        # Un único objeto con alta cobertura de frame probablemente fue fotografiado
        # de cerca (botella, bolsa suelta) y no representa un acúmulo real.
        scale_penalty_applied = (
            coverage_ratio > ISOLATION_COVERAGE_THRESHOLD
            and num_detecciones <= ISOLATION_DET_THRESHOLD
        )
        if scale_penalty_applied:
            effective_ratio *= ISOLATION_PENALTY

        # ── Paso 3: ajuste por peligrosidad del tipo de residuo ──────────────────
        class_weight    = CLASS_WEIGHTS.get(tipo_residuo, 1.00)
        effective_ratio = min(1.0, effective_ratio * class_weight)

        # ── Paso 4: clasificación por bandas con interpolación lineal ────────────
        metricas = {"nivel": "CRITICO", "prioridad": "CRITICA", "volumen": 15.0}
        for c_min, c_max, v_min, v_max, nivel, prioridad in _BANDS:
            if effective_ratio < c_max or c_max == 1.00:
                t = max(0.0, min(1.0, (effective_ratio - c_min) / (c_max - c_min)))
                metricas = {
                    "nivel":     nivel,
                    "prioridad": prioridad,
                    "volumen":   round(v_min + t * (v_max - v_min), 2),
                }
                break

        return {
            "success":               True,
            "has_waste":             True,
            "nivel_acumulacion":     metricas["nivel"],
            "volumen_estimado_m3":   metricas["volumen"],
            "prioridad":             metricas["prioridad"],
            "tipo_residuo":          tipo_residuo,
            "confianza":             confianza,
            "num_detecciones":       num_detecciones,
            "coverage_ratio":        coverage_ratio,
            "detecciones":           detecciones,
            "scale_penalty_applied": scale_penalty_applied,
            "tiempo_inferencia_ms":  tiempo_ms,
            "modelo_nombre":         model_name,
        }

    except SoftTimeLimitExceeded as exc:
        # Inferencia colgada: limpiar la imagen antes de reintentar / ir a DLQ
        try:
            Path(image_path).unlink(missing_ok=True)
        except OSError:
            pass
        _retry_or_dlq(
            self, exc,
            payload={
                "image_path":   image_path,
                "image_width":  image_width,
                "image_height": image_height,
            },
        )
    except Exception as exc:
        # Reintenta con backoff exponencial; si agota max_retries → DLQ
        _retry_or_dlq(
            self, exc,
            payload={
                "image_path":   image_path,
                "image_width":  image_width,
                "image_height": image_height,
            },
        )
