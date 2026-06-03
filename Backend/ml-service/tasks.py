import json
import logging
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from celery import signals
from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded
from celery_app import celery
from config_classes import ALIAS_MAP, CLASS_WEIGHTS, VALID_ALIASES
from ml_utils import (
    coverage_union         as _coverage_union,
    is_clustered           as _is_clustered,
    compute_garbage_score  as _compute_garbage_score,
    compute_blur_score     as _compute_blur_score,
    estimate_volume_midas  as _estimate_volume_midas,
)
from semantic_gate import verify_is_garbage as _verify_is_garbage, warm_up_clip as _warm_up_clip

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
NMS_CONF            = 0.60   # confianza mínima para aceptar una detección (subido de 0.50 tras incidente F2998975: mochila aceptada con 0.86)
NMS_IOU             = 0.50   # IoU máximo para NMS (supresión de duplicados)
MIN_BBOX_AREA_RATIO = 0.010  # bbox < 1 % del frame → descartado como ruido (era 0.005)

# ── Factores de clasificación ─────────────────────────────────────────────────
CONF_NORMALIZATION_BASELINE = 0.60  # confianza ≥ este valor → conf_factor = 1.0

# det_factor logarítmico: 1 − e^(−k·n), tope en CEILING
# Evita la saturación prematura del lineal (antes: 3 cajas = 1.0, ahora: 5 cajas ≈ 0.92)
DET_FACTOR_K       = 0.50   # constante de decaimiento; n=3 → 0.78, n=5 → 0.92
DET_FACTOR_CEILING = 0.90   # tope absoluto del factor de detección

# ── Corrección de ambigüedad de escala (falso positivo por acercamiento) ─────
# Caso 1: objeto único con alta cobertura (botella, bolsa suelta fotografiada de cerca).
# Caso 2: múltiples bboxes concentrados sobre el mismo objeto (close-up con varias cajas).
#
# Se aplican dos niveles de penalización según cuánto cubre el frame:
#   FULL_FRAME (> 85 %): el objeto ocupa prácticamente toda la imagen → close-up evidente.
#     Penalización fuerte (×0.20) para degradar a banda BAJO independientemente de confianza.
#     Ejemplo: funda de laptop, botella sostenida, objeto inspeccionado de cerca.
#   ISOLATION (55 %–85 %): cobertura alta pero no total → penalización moderada (×0.65).
#     Ejemplo: bolsa de basura grande en primer plano, objeto aislado dominando la escena.
FULL_FRAME_COVERAGE_THRESHOLD = 0.85  # cobertura casi total → close-up, penalización fuerte
FULL_FRAME_PENALTY            = 0.20  # multiplicador para close-up de objeto único
ISOLATION_COVERAGE_THRESHOLD  = 0.55  # cobertura alta moderada → Caso 1 con penalización suave
ISOLATION_DET_THRESHOLD       = 1     # máximo de detecciones para considerar Caso 1
ISOLATION_PENALTY             = 0.40  # multiplicador moderado (bajado de 0.65 tras falso positivo de mochila con coverage~60%)
CLUSTER_DIAG_THRESHOLD        = 0.30  # diagonal de centroides < 30 % frame-diag → cluster

# ── Diversidad geométrica requerida para CRÍTICO ──────────────────────────────
CRITICO_MIN_DETS = 3  # mínimo de detecciones dispersas para alcanzar banda CRÍTICO

# ── Filtrado por textura (garbage scoring) ────────────────────────────────────
# Umbral para decidir si la detección tiene textura de basura real.
# Bajo el umbral: objeto liso/uniforme → penalización full-frame completa.
# Sobre el umbral: textura caótica, colores variados → penalización reducida.
GARBAGE_SCORE_THRESHOLD = 0.50  # subido de 0.45 para ser más estricto con objetos lisos

# Piso duro: por debajo de este score la imagen no tiene NADA de basura
# (textura uniforme + sin bordes + posición no típica). Se descarta como falso
# positivo del modelo sin importar la confianza ni el coverage. Devuelve
# has_waste=false → backend aplica AUTO_REJECT_CONFIDENCE → DESCARTADO o EN_REVISION.
GARBAGE_SCORE_HARD_FLOOR = 0.20

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


@signals.worker_init.connect
def _preload_model_on_startup(**kwargs):
    """Pre-carga todos los modelos al arrancar el worker (no en el primer request).

    Carga en orden:
      1. RT-DETR-L  — detector de residuos principal
      2. CLIP ViT-B/32 — gate semántico para filtrar falsos positivos

    Garantiza que todos los modelos estén en memoria antes de que llegue la
    primera tarea, eliminando latencia de cold-start bajo carga.
    """
    if not DUMMY_MODE:
        _get_model()
        _warm_up_clip()


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

    try:
        img = Image.open(image_path).convert("RGB")

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

        detecciones = []
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
        # coverage_ratio como UNIÓN de bboxes (no suma) → corrige inflación por solapamiento
        coverage_ratio  = _coverage_union(detecciones, img_w, img_h)
        confianza       = round(sum(d["confidence"] for d in detecciones) / num_detecciones, 4)
        dominant_class  = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
        tipo_residuo    = ALIAS_MAP.get(dominant_class.lower(), "OTRO")

        # ── Gate 1: cobertura mínima global ──────────────────────────────────────
        # Filtra detecciones demasiado pequeñas/lejanas donde el volumen y la
        # prioridad estimados no son confiables. Un objeto que ocupa < 3% del frame
        # está demasiado lejos para ser evaluado correctamente.
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
            }

        # ── Garbage score: probabilidad de textura de basura real ────────────────
        # score < GARBAGE_SCORE_THRESHOLD → objeto liso (funda, bolso, botella).
        # score ≥ GARBAGE_SCORE_THRESHOLD → textura caótica → probable residuo.
        # Se computa aquí (antes de los pasos de penalización) porque modula la
        # severidad de la penalización de escala en el Paso 2.
        garbage_score = _compute_garbage_score(img, detecciones, img_w, img_h)

        # ── Paso 1b: rechazo duro por garbage_score crítico ──────────────────────
        # Si la imagen no tiene NINGUNA señal de basura (textura, color, posición),
        # se descarta como falso positivo del modelo independientemente de la
        # confianza y el coverage. Atrapa el caso mochila/bolso/laptop fotografiado
        # de cerca donde el modelo emite "garbage" con alta confianza.
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
            }

        # ── Gate 2: verificación semántica CLIP ───────────────────────────────────
        # Comprueba si la imagen contiene basura real o un falso positivo semántico
        # (personas, interiores, pantallas, vehículos, etc.) que el detector confunde.
        #
        # El detector RT-DETR solo aprendió basura + calles vacías como negativo.
        # CLIP fue entrenado con cientos de millones de fotos; sabe qué es una persona,
        # un interior, una pantalla — y los diferencia de un montón de basura.
        #
        # Política de decisión:
        #   garbage_prob < REJECT  → claramente no-basura → DESCARTADO (confianza alta)
        #   REJECT ≤ prob < REVIEW → ambiguo → EN_REVISION (confianza baja, needs_review)
        #   prob ≥ REVIEW          → basura confirmada → flujo normal → PENDIENTE
        semantic = _verify_is_garbage(img)
        garbage_prob      = semantic["garbage_prob"]
        semantic_top      = semantic["top_label"]
        semantic_error    = semantic["error"]

        if semantic_error:
            logger.warning(
                "[run_inference] CLIP falló (%s) — fail-open: marcando requiere_revision=True",
                semantic_error,
            )

        if not semantic["is_garbage"] and not semantic["needs_review"]:
            # Claramente NO es basura — confianza alta para que el backend lo DESCARTE
            # automáticamente (confianza ≥ AUTO_REJECT_CONFIDENCE → RECHAZO_CONFIABLE)
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
            }

        # Ambigüedad semántica → marcar para revisión humana, pero continuar
        # calculando la clasificación por bandas para dar contexto al supervisor.
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

        # ── Paso 1: effective_ratio base ─────────────────────────────────────────
        # det_factor logarítmico: evita saturar en 1.0 con solo 3 cajas (antes lineal).
        # Con k=0.5: n=1→0.39, n=3→0.78, n=5→0.92, tope 0.90.
        # TODO(M-08): calibrar k y CEILING con dataset etiquetado antes de modificar bandas.
        conf_factor     = min(1.0, confianza / CONF_NORMALIZATION_BASELINE)
        det_factor      = min(DET_FACTOR_CEILING, 1.0 - math.exp(-DET_FACTOR_K * num_detecciones))
        effective_ratio = coverage_ratio * conf_factor * det_factor

        # ── Paso 2: corrección de ambigüedad de escala ───────────────────────────
        # Caso 1a — FULL-FRAME: objeto único cubre > 85 % del encuadre (close-up evidente).
        #   Penalización fuerte (×0.20) → banda BAJO. Aplica a: fundas, botellas, cualquier
        #   objeto no-basura fotografiado de muy cerca que el modelo confunde con residuo.
        # Caso 1b — ISOLATION: cobertura 55-85 %, detección única → penalización moderada.
        # Caso 2 — múltiples bboxes concentrados (close-up con varias cajas superpuestas).
        clustered = _is_clustered(detecciones, img_w, img_h)
        is_single = (num_detecciones <= ISOLATION_DET_THRESHOLD)

        if is_single and coverage_ratio > FULL_FRAME_COVERAGE_THRESHOLD:
            # Penalización interpolada por garbage_score:
            #   score=0.0 (objeto liso) → FULL_FRAME_PENALTY (0.20)
            #   score≥GARBAGE_SCORE_THRESHOLD (basura real) → ISOLATION_PENALTY (0.65)
            # Esto preserva la penalización máxima para fundas/bolsos lisos mientras
            # reduce el castigo cuando el objeto sí tiene textura de residuo.
            t_score = min(1.0, garbage_score / GARBAGE_SCORE_THRESHOLD)
            penalty = FULL_FRAME_PENALTY + (ISOLATION_PENALTY - FULL_FRAME_PENALTY) * t_score
            effective_ratio *= penalty
            scale_penalty_applied = True
        elif (is_single and coverage_ratio > ISOLATION_COVERAGE_THRESHOLD) or (num_detecciones >= 2 and clustered):
            # Cobertura moderada o cluster: si hay textura de basura real, reducir penalización.
            #   score=0.0 → ISOLATION_PENALTY (0.65)
            #   score≥GARBAGE_SCORE_THRESHOLD → sin penalización (1.0)
            t_score = min(1.0, garbage_score / GARBAGE_SCORE_THRESHOLD)
            penalty = ISOLATION_PENALTY + (1.0 - ISOLATION_PENALTY) * t_score
            effective_ratio *= penalty
            scale_penalty_applied = penalty < 0.999
        else:
            scale_penalty_applied = False

        # ── Paso 3: ajuste por peligrosidad del tipo de residuo ──────────────────
        class_weight    = CLASS_WEIGHTS.get(tipo_residuo, 1.00)
        effective_ratio = min(1.0, effective_ratio * class_weight)

        # ── Paso 3b: diversidad geométrica requerida para banda CRÍTICO ──────────
        # CRITICO (effective_ratio ≥ 0.70) solo se confirma si hay ≥ CRITICO_MIN_DETS
        # detecciones que NO estén concentradas en un cluster.
        # Esto bloquea el caso "1–2 bboxes con coverage sintéticamente alto".
        _CRITICO_MIN_RATIO = _BANDS[3][0]  # 0.70
        if effective_ratio >= _CRITICO_MIN_RATIO:
            well_spread = (
                num_detecciones >= CRITICO_MIN_DETS
                and not clustered
            )
            if not well_spread:
                effective_ratio = _CRITICO_MIN_RATIO - 0.001  # degradar al techo de ALTO

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

        # ── Paso 5 (opcional): volumen con profundidad monocular MiDaS ──────────
        # Si USE_MIDAS_VOLUME=true, substituye el volumen interpolado por banda con
        # la estimación basada en geometría real (calibrada al plano de suelo).
        # Falla silenciosamente → fallback al volumen de banda si MiDaS no está disponible.
        #
        # Si client_coverage_ratio está disponible (enviado desde el móvil tras la
        # guía de distancia del frame processor), se usa para ajustar GROUND_DEPTH_M:
        # coverage ≈ 0.50 a 2 m de distancia → ratio = sqrt(0.50 / client_coverage)
        # escala la distancia de referencia proporcionalmente.
        if USE_MIDAS_VOLUME:
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
                metricas["volumen"] = round(min(20.0, midas_vol), 2)

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
