import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import signals
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from celery_app import celery
from config_classes import ALIAS_MAP, VALID_ALIASES
from ml_utils import (
    coverage_union         as _coverage_union,
    is_clustered           as _is_clustered,
    compute_garbage_score  as _compute_garbage_score,
    compute_blur_score     as _compute_blur_score,
    estimate_volume_midas  as _estimate_volume_midas,
    warm_up_midas          as _warm_up_midas,
    classify_severity      as _classify_severity,
    GARBAGE_SCORE_HARD_FLOOR,
)
from semantic_gate import verify_is_garbage as _verify_is_garbage, warm_up_clip as _warm_up_clip

logger = logging.getLogger(__name__)

DUMMY_MODE = os.environ.get("DUMMY_MODE", "true").lower() == "true"

# ── NMS / filtrado de detecciones ────────────────────────────────────────────
NMS_CONF            = 0.60   # confianza mínima para aceptar una detección (subido de 0.50 tras incidente F2998975: mochila aceptada con 0.86)
NMS_IOU             = 0.50   # IoU máximo para NMS (supresión de duplicados)
MIN_BBOX_AREA_RATIO = 0.010  # bbox < 1 % del frame → descartado como ruido (era 0.005)

# ── Clasificación de severidad ────────────────────────────────────────────────
# La lógica de bandas/factores (_BANDS, DET_FACTOR_*, ISOLATION_*, FULL_FRAME_*,
# CRITICO_MIN_DETS, GARBAGE_SCORE_THRESHOLD, GARBAGE_SCORE_HARD_FLOOR, rescate de
# pila única) vive ahora en ml_utils como fuente única de verdad. classify_severity
# se invoca en el Paso 4; GARBAGE_SCORE_HARD_FLOOR se importa para el Paso 1b.

# ── Volumen con profundidad monocular (MiDaS) ─────────────────────────────────
# Activado con USE_MIDAS_VOLUME=true en el entorno del ml-worker.
# Si MiDaS falla o la imagen es inválida, se usa el volumen interpolado por banda.
USE_MIDAS_VOLUME = os.environ.get("USE_MIDAS_VOLUME", "false").lower() == "true"

# ── Gate de calidad de imagen: desenfoque ─────────────────────────────────────
# Varianza del Laplaciano mínima para aceptar la imagen como utilizable.
# Fotos muy borrosas generan detecciones poco confiables independientemente de
# la confianza del modelo. Umbral calibrado para imágenes de 640 px:
#   · Foto nítida de calle: varianza ~800-2000
#   · Foto ligeramente movida: ~200-400
#   · Foto muy borrosa/desenfocada: <100
# Configurable vía BLUR_VARIANCE_MIN; 0 = desactiva el gate de blur.
BLUR_VARIANCE_MIN = float(os.environ.get("BLUR_VARIANCE_MIN", "0"))

# ── Gate de cobertura mínima global ───────────────────────────────────────────
# Coverage ratio mínimo de la unión de bboxes para que el resultado sea válido.
# Filtra detecciones de basura diminuta/lejana donde la estimación de volumen
# y prioridad no es confiable. 3% del frame ≈ objeto de ~90×90 px en 640p.
# Configurable vía MIN_COVERAGE_UNION; 0 = desactiva el gate de cobertura.
MIN_COVERAGE_UNION = float(os.environ.get("MIN_COVERAGE_UNION", "0.03"))

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


@signals.worker_process_init.connect
def _preload_model_on_startup(**kwargs):
    """Pre-carga RT-DETR en CADA hijo después del fork (no en el padre).

    worker_process_init fires en cada proceso hijo tras el fork — esto evita
    el deadlock conocido de PyTorch+fork: si el padre carga el modelo (con
    threadpools internos OMP/MKL) y luego forkea, los hijos heredan referencias
    a hilos que no existen → futex_wait_queue_me eterno → tareas nunca completan.

    CLIP (semantic_gate) se carga lazy en el primer verify_is_garbage() real
    para evitar un segundo deadlock: open_clip.create_model_and_transforms() +
    hf_hub_download() dentro de un ForkPoolWorker cuelga ~300 s incluso con
    HF_HUB_OFFLINE=1 (huggingface_hub hace al menos un request de telemetría
    que bloquea en TCP hasta el soft_time_limit).
    """
    if not DUMMY_MODE:
        _get_model()


@signals.worker_ready.connect
def _submit_warmup_tasks(**kwargs):
    """Envía tareas de warm-up de CLIP justo cuando los workers están listos.

    worker_ready fires en el PROCESO PADRE (no en un ForkPoolWorker), por eso
    no hay riesgo de deadlock TCP/fork. Las tareas de warm-up se encolan en
    Redis y cada worker las toma en contexto de ejecución normal (seguro).
    Resultado: CLIP queda cargado antes de que llegue el primer request real.
    """
    if not DUMMY_MODE:
        concurrency = int(os.environ.get("WORKER_CONCURRENCY", "2"))
        for _ in range(concurrency):
            warmup_clip_task.delay()
        logger.info("[startup] %d tarea(s) de warm-up CLIP enviadas", concurrency)


@celery.task(
    name="ml_worker.warmup_clip",
    queue="ml_queue",
    max_retries=0,
    ignore_result=True,
    soft_time_limit=300,  # CLIP en este VPS: ~41s carga + ~80s encode_text = ~120s total
    time_limit=360,
)
def warmup_clip_task():
    """Pre-carga CLIP (y MiDaS si está activo) en el worker.

    Ejecuta en contexto de task normal (no en el fork de worker_process_init),
    por eso es seguro cargar modelos pesados aquí sin el deadlock TCP/fork.
    """
    if DUMMY_MODE:
        return
    ok = _warm_up_clip()
    if ok:
        logger.info("[warmup_clip] CLIP listo en este worker")
    else:
        logger.warning("[warmup_clip] CLIP falló al cargar — se reintentará en el primer request real")
    # MiDaS solo se precarga si la estimación de volumen real está activa.
    if USE_MIDAS_VOLUME:
        if _warm_up_midas():
            logger.info("[warmup_clip] MiDaS listo en este worker")
        else:
            logger.warning("[warmup_clip] MiDaS falló al cargar — se cargará en el primer request real")


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


def _extract_detections(results, min_bbox_area: float) -> list[dict]:
    """Filtra las detecciones del modelo: solo aliases válidos y bbox sobre el área mínima."""
    detecciones: list[dict] = []
    if not results:
        return detecciones
    boxes, names = results[0].boxes, results[0].names
    if boxes is None or len(boxes) == 0:
        return detecciones
    for box in boxes:
        class_name = names[int(box.cls[0])]
        if class_name.lower() not in VALID_ALIASES:
            continue
        x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
        if (x2 - x1) * (y2 - y1) < min_bbox_area:
            continue
        detecciones.append({
            "class":      class_name,
            "confidence": round(float(box.conf[0]), 4),
            "bbox":       [x1, y1, x2, y2],
        })
    return detecciones


def _evaluate_quality_gates(img, detecciones, img_w, img_h, coverage_ratio, confianza,
                            num_detecciones, blur_score, tiempo_ms, model_name):
    """Gates de calidad post-detección (cobertura mínima, garbage_score, CLIP semántico).

    Devuelve (rechazo, señales): si 'rechazo' no es None, run_inference lo retorna tal cual.
    Si es None, 'señales' trae garbage_score/garbage_prob/semantic_top/requiere_revision para
    continuar con la clasificación de severidad.
    """
    # ── Gate 1: cobertura mínima global ──────────────────────────────────────
    if MIN_COVERAGE_UNION > 0 and coverage_ratio < MIN_COVERAGE_UNION:
        logger.info(
            "[run_inference] Rechazo por coverage_ratio=%.4f < umbral=%.3f "
            "(objeto demasiado pequeño/lejano) → has_waste=false",
            coverage_ratio, MIN_COVERAGE_UNION,
        )
        return {
            "success":              True,
            "has_waste":            False,
            "message":              "Detección demasiado pequeña — acércate al objeto",
            "confianza":            0.45,  # < AUTO_REJECT_CONFIDENCE → EN_REVISION
            "coverage_ratio":       coverage_ratio,
            "num_detecciones":      num_detecciones,
            "rechazo_motivo":       "coverage_below_floor",
            "blur_score":           round(blur_score, 2) if blur_score is not None else None,
            "tiempo_inferencia_ms": tiempo_ms,
            "modelo_nombre":        model_name,
        }, None

    # ── Garbage score: probabilidad de textura de basura real ────────────────
    garbage_score = _compute_garbage_score(img, detecciones, img_w, img_h)

    # ── Paso 1b: rechazo duro por garbage_score crítico ──────────────────────
    if garbage_score < GARBAGE_SCORE_HARD_FLOOR:
        logger.info(
            "[run_inference] Rechazo por garbage_score=%.3f < hard_floor=%.2f "
            "(conf=%.2f, n_dets=%d) → has_waste=false",
            garbage_score, GARBAGE_SCORE_HARD_FLOOR, confianza, num_detecciones,
        )
        return {
            "success":              True,
            "has_waste":            False,
            "message":              "Imagen rechazada: sin señales de basura (textura/color/posición)",
            "confianza":            confianza,
            "garbage_score":        garbage_score,
            "blur_score":           round(blur_score, 2) if blur_score is not None else None,
            "num_detecciones":      num_detecciones,
            "rechazo_motivo":       "garbage_score_below_hard_floor",
            "tiempo_inferencia_ms": tiempo_ms,
            "modelo_nombre":        model_name,
        }, None

    # ── Gate 2: verificación semántica CLIP ──────────────────────────────────
    rechazo_sem, sem = _semantic_gate(img, garbage_score, blur_score, num_detecciones, tiempo_ms, model_name)
    if rechazo_sem is not None:
        return rechazo_sem, None

    return None, {
        "garbage_score":     garbage_score,
        "garbage_prob":      sem["garbage_prob"],
        "semantic_top":      sem["semantic_top"],
        "requiere_revision": sem["requiere_revision"],
    }


def _semantic_gate(img, garbage_score, blur_score, num_detecciones, tiempo_ms, model_name):
    """Gate semántico CLIP: distingue basura real de falsos positivos (personas,
    interiores, pantallas, vehículos). Devuelve (rechazo, señales_semánticas).

    Política: garbage_prob < REJECT → DESCARTADO; REJECT ≤ prob < REVIEW → EN_REVISION
    (needs_review); prob ≥ REVIEW → flujo normal.
    """
    semantic = _verify_is_garbage(img)
    garbage_prob   = semantic["garbage_prob"]
    semantic_top   = semantic["top_label"]

    if semantic["error"]:
        logger.warning(
            "[run_inference] CLIP falló (%s) — fail-open: marcando requiere_revision=True",
            semantic["error"],
        )

    if not semantic["is_garbage"] and not semantic["needs_review"]:
        # Claramente NO es basura — confianza alta para que el backend lo DESCARTE
        auto_reject_conf = float(os.environ.get("ML_AUTO_REJECT_CONFIDENCE", "0.70"))
        reported_conf = round(max(auto_reject_conf, 1.0 - (garbage_prob or 0.0)), 4)
        logger.info(
            "[run_inference] CLIP rechaza: garbage_prob=%.3f < reject=%.2f "
            "top='%s' → DESCARTADO (conf=%.3f)",
            garbage_prob or 0.0, semantic["is_garbage"], semantic_top, reported_conf,
        )
        return {
            "success":              True,
            "has_waste":            False,
            "message":              f"Imagen rechazada por verificación semántica: {semantic_top}",
            "confianza":            reported_conf,
            "garbage_prob":         garbage_prob,
            "garbage_score":        garbage_score,
            "blur_score":           round(blur_score, 2) if blur_score is not None else None,
            "num_detecciones":      num_detecciones,
            "rechazo_motivo":       "semantic_gate_not_garbage",
            "semantic_top_label":   semantic_top,
            "tiempo_inferencia_ms": tiempo_ms,
            "modelo_nombre":        model_name,
        }, None

    # Ambigüedad semántica → marcar para revisión humana, pero continuar
    requiere_revision = semantic["needs_review"]
    if requiere_revision:
        logger.info(
            "[run_inference] CLIP dudoso: garbage_prob=%.3f en zona ambigua "
            "(reject=%.2f, review=%.2f) top='%s' → requiere_revision=True",
            garbage_prob or 0.0,
            float(os.environ.get("SEMANTIC_REJECT_THRESHOLD", "0.30")),
            float(os.environ.get("SEMANTIC_REVIEW_THRESHOLD", "0.62")),
            semantic_top,
        )

    return None, {
        "garbage_prob":      garbage_prob,
        "semantic_top":      semantic_top,
        "requiere_revision": requiere_revision,
    }


def _apply_midas_volume(metricas, img, detecciones, img_w, img_h, client_coverage_ratio):
    """Paso 5 (opcional): substituye el volumen de banda por la estimación MiDaS acotada
    al rango [vol_min, vol_max] del nivel. No-op si USE_MIDAS_VOLUME=false o si MiDaS no
    está disponible. Muta metricas['volumen'] en el sitio."""
    if not USE_MIDAS_VOLUME:
        return
    from ml_utils import GROUND_DEPTH_M
    ground_m = GROUND_DEPTH_M
    if client_coverage_ratio and 0.05 <= client_coverage_ratio <= 0.95:
        import math as _math
        # Escalar distancia de referencia: más coverage → más cerca → menor distancia
        scale = _math.sqrt(0.50 / client_coverage_ratio)
        ground_m = round(max(0.5, min(8.0, GROUND_DEPTH_M * scale)), 2)
        logger.info("[tasks] MiDaS calibrado: coverage=%.3f → ground_m=%.2f (base=%.1f)",
                    client_coverage_ratio, ground_m, GROUND_DEPTH_M)
    midas_vol = _estimate_volume_midas(img, detecciones, img_w, img_h,
                                       ground_depth_m_override=ground_m)
    if midas_vol is not None:
        # ── Medir + acotar ────────────────────────────────────────────────
        v_lo = metricas["vol_band_min"]
        v_hi = metricas["vol_band_max"]
        clamped = max(v_lo, min(v_hi, midas_vol))
        metricas["volumen"] = round(clamped, 2)
        logger.info(
            "[tasks] MiDaS vol_real=%.2f → acotado a [%.2f, %.2f] = %.2f m³ (nivel=%s)",
            midas_vol, v_lo, v_hi, metricas["volumen"], metricas["nivel"],
        )


@celery.task(
    bind=True,
    name="ml_worker.run_inference",
    max_retries=3,
    queue="ml_queue",
    soft_time_limit=300,  # 5 min: permite limpieza antes del SIGKILL
    time_limit=360,       # 6 min: fuerza terminación si soft_time_limit se ignoró
)
def run_inference(self, image_path: str, image_width: int = 1280, image_height: int = 960, client_coverage_ratio: float | None = None):
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

    logger.info("[run_inference] START task_id=%s image=%s", self.request.id, image_path)
    print(f"[run_inference] START task_id={self.request.id} image={image_path}", flush=True)

    try:
        img = Image.open(image_path).convert("RGB")
        logger.info("[run_inference] image loaded %dx%d", *img.size)
        print(f"[run_inference] image loaded {img.size[0]}x{img.size[1]}", flush=True)

        img_w, img_h = img.size
        img_area      = img_w * img_h
        min_bbox_area = img_area * MIN_BBOX_AREA_RATIO

        # ── Gate 0: desenfoque (blur) ─────────────────────────────────────────
        # Verificación rápida (~2 ms) antes de invocar al detector.
        # Una imagen muy borrosa hace que RT-DETR produzca bboxes poco confiables;
        # es mejor pedir al usuario que reenvíe una foto nítida (EN_REVISION).
        if BLUR_VARIANCE_MIN > 0:
            blur_score = _compute_blur_score(img)
            if blur_score < BLUR_VARIANCE_MIN:
                logger.info(
                    "[run_inference] Rechazo por blur_score=%.1f < umbral=%.1f "
                    "(imagen demasiado borrosa) → has_waste=false",
                    blur_score, BLUR_VARIANCE_MIN,
                )
                return {
                    "success":              True,
                    "has_waste":            False,
                    "message":              "Imagen rechazada: demasiado borrosa o desenfocada",
                    "confianza":            0.40,  # < AUTO_REJECT_CONFIDENCE → EN_REVISION
                    "blur_score":           round(blur_score, 2),
                    "rechazo_motivo":       "image_too_blurry",
                    "tiempo_inferencia_ms": 0,
                    "modelo_nombre":        Path(os.environ.get("ML_MODEL_PATH", "rtdetr_l_best.pt")).name,
                }
        else:
            blur_score = None  # gate desactivado

        model   = _get_model()
        t_start = time.time()
        results = model.predict(img, conf=NMS_CONF, iou=NMS_IOU, verbose=False)
        tiempo_ms = int((time.time() - t_start) * 1000)

        detecciones = _extract_detections(results, min_bbox_area)

        model_name = Path(os.environ.get("ML_MODEL_PATH", "rtdetr_l_best.pt")).name

        # Liberar espacio en el volumen compartido: el worker es el último consumidor
        try:
            Path(image_path).unlink(missing_ok=True)
        except OSError:
            pass

        if not detecciones:
            # confianza=0.95 → image-service aplica DESCARTADO (no EN_REVISION)
            # y dispara la notificación "Imagen sin residuos detectados" al ciudadano.
            # 0 detecciones sobre el umbral de confianza del modelo es un rechazo seguro.
            return {
                "success":              True,
                "has_waste":            False,
                "confianza":            0.95,
                "rechazo_motivo":       "no_detections",
                "message":              "No se detectaron residuos válidos",
                "tiempo_inferencia_ms": tiempo_ms,
                "modelo_nombre":        model_name,
            }

        num_detecciones = len(detecciones)
        # coverage_ratio como UNIÓN de bboxes (no suma) → corrige inflación por solapamiento
        coverage_ratio  = _coverage_union(detecciones, img_w, img_h)
        confianza       = round(sum(d["confidence"] for d in detecciones) / num_detecciones, 4)
        dominant_class  = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
        tipo_residuo    = ALIAS_MAP.get(dominant_class.lower(), "OTRO")

        # ── Gates de calidad: cobertura mínima, garbage_score y CLIP semántico ───
        rechazo, senales = _evaluate_quality_gates(
            img, detecciones, img_w, img_h, coverage_ratio, confianza,
            num_detecciones, blur_score, tiempo_ms, model_name,
        )
        if rechazo is not None:
            return rechazo
        garbage_score     = senales["garbage_score"]
        garbage_prob      = senales["garbage_prob"]
        semantic_top      = senales["semantic_top"]
        requiere_revision = senales["requiere_revision"]

        # ── Pasos 1-4: clasificación de severidad (fuente única en ml_utils) ─────
        # Calcula effective_ratio (coverage·conf·det) con rescate de pila única,
        # penalizaciones de escala interpoladas por garbage_score, peso por clase,
        # guarda geométrica de CRÍTICO y mapeo a banda con interpolación de volumen.
        metricas = _classify_severity(
            coverage_ratio=coverage_ratio,
            confianza=confianza,
            num_detecciones=num_detecciones,
            garbage_score=garbage_score,
            tipo_residuo=tipo_residuo,
            detecciones=detecciones,
            img_w=img_w,
            img_h=img_h,
        )
        clustered             = metricas["detections_clustered"]
        scale_penalty_applied = metricas["scale_penalty_applied"]
        pile_rescue_applied   = metricas["pile_rescue_applied"]
        logger.info(
            "[run_inference] clasificación: nivel=%s prioridad=%s eff=%.3f vol=%.2f "
            "(n_dets=%d cov=%.3f score=%.3f pile_rescue=%s scale_penalty=%s)",
            metricas["nivel"], metricas["prioridad"], metricas["effective_ratio"],
            metricas["volumen"], num_detecciones, coverage_ratio, garbage_score,
            pile_rescue_applied, scale_penalty_applied,
        )

        # ── Paso 5 (opcional): volumen con profundidad monocular MiDaS ──────────
        # Si USE_MIDAS_VOLUME=true, substituye el volumen interpolado por banda con la
        # estimación geométrica de MiDaS, acotada al rango de la banda (medir + acotar).
        _apply_midas_volume(metricas, img, detecciones, img_w, img_h, client_coverage_ratio)

        result = {
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
            "pile_rescue_applied":   pile_rescue_applied,
            "detections_clustered":  clustered,
            "garbage_score":         garbage_score,
            # ── Campos de trazabilidad de los gates ────────────────────────────
            "garbage_prob":          garbage_prob,
            "semantic_top_label":    semantic_top,
            "blur_score":            round(blur_score, 2) if blur_score is not None else None,
            "tiempo_inferencia_ms":  tiempo_ms,
            "modelo_nombre":         model_name,
        }

        # Si CLIP marcó ambigüedad, añadir flag para que el backend rute a EN_REVISION.
        # La clasificación por bandas se completa igual para darle contexto al supervisor.
        if requiere_revision:
            result["requiere_revision"] = True
            result["rechazo_motivo"]    = "verificacion_semantica_ambigua"

        return result

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
