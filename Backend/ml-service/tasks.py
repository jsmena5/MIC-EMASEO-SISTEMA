import os
import time

from celery import signals
from celery_app import celery

DUMMY_MODE = os.environ.get("DUMMY_MODE", "true").lower() == "true"

# ── Clases válidas de residuos y mapeo a categorías ──────────────────────────
_VALID_WASTE_CLASSES = frozenset({"garbage", "basura"})
_V2_CLASS_MAP = {
    "garbage":    "MIXTO",      "basura":      "MIXTO",
    "plastico":   "RECICLABLE", "plastic":     "RECICLABLE",
    "organico":   "ORGANICO",   "organic":     "ORGANICO",
    "escombros":  "ESCOMBROS",  "debris":      "ESCOMBROS",
    "peligroso":  "PELIGROSO",  "hazardous":   "PELIGROSO",
    "domestico":  "DOMESTICO",  "domestic":    "DOMESTICO",
    "reciclable": "RECICLABLE", "recyclable":  "RECICLABLE",
}

# ── Bandas de severidad: (cov_min, cov_max, vol_min, vol_max, nivel, prioridad)
_BANDS = [
    (0.00, 0.15, 0.1,  0.5,  "BAJO",    "BAJA"),
    (0.15, 0.40, 0.5,  2.0,  "MEDIO",   "MEDIA"),
    (0.40, 0.70, 2.0,  5.0,  "ALTO",    "ALTA"),
    (0.70, 1.00, 5.0, 15.0,  "CRITICO", "CRITICA"),
]

# ── NMS / filtrado de detecciones ────────────────────────────────────────────
NMS_CONF            = 0.60   # confianza mínima para aceptar una detección
NMS_IOU             = 0.45   # IoU máximo para NMS (supresión de duplicados)
MIN_BBOX_AREA_RATIO = 0.005  # bbox < 0.5 % del frame → descartado como ruido

# ── Factores base de clasificación ───────────────────────────────────────────
CONF_NORMALIZATION_BASELINE = 0.70  # confianza ≥ este valor → conf_factor = 1.0
DET_FACTOR_BASE             = 0.40  # piso del factor de detección (1 solo objeto)
DET_FACTOR_STEP             = 0.20  # incremento por cada detección adicional

# ── Corrección de ambigüedad de escala (falso positivo por acercamiento) ─────
# Activada cuando hay 1 objeto aislado Y su cobertura supera el umbral.
# Contraejemplo deseado: un acúmulo real grande con 1 solo bbox enorme NO debería
# disparar esto (su confianza y contexto visual serán diferentes al de un close-up).
ISOLATION_COVERAGE_THRESHOLD = 0.55  # coverage_ratio mínimo para activar la corrección
ISOLATION_DET_THRESHOLD      = 1     # máximo de detecciones para considerar "aislado"
ISOLATION_PENALTY            = 0.65  # multiplicador sobre effective_ratio

# ── Pesos por tipo de residuo ─────────────────────────────────────────────────
# Se aplican DESPUÉS de la corrección de escala, sobre el effective_ratio final.
# > 1.0 → escalar severidad hacia arriba (materiales de mayor impacto)
# < 1.0 → reducir severidad (materiales de menor urgencia operativa)
CLASS_WEIGHTS = {
    "PELIGROSO":  1.30,  # residuos tóxicos/químicos → máxima escalada
    "ESCOMBROS":  1.20,  # escombros → bloquean vías, requieren maquinaria
    "MIXTO":      1.00,  # línea base
    "DOMESTICO":  0.90,  # basura doméstica común
    "ORGANICO":   0.95,  # orgánico → descomposición natural, menor urgencia
    "RECICLABLE": 0.85,  # reciclable → menor urgencia operativa
    "OTRO":       1.00,
}

_model = None


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


@celery.task(bind=True, name="ml_worker.run_inference", max_retries=3)
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
    except Exception as exc:
        raise self.retry(exc=exc, countdown=5)

    img_w, img_h = img.size
    img_area      = img_w * img_h
    min_bbox_area = img_area * MIN_BBOX_AREA_RATIO

    model  = _get_model()
    t_start = time.time()
    results = model.predict(img, conf=NMS_CONF, iou=NMS_IOU, verbose=False)
    tiempo_ms = int((time.time() - t_start) * 1000)

    detecciones, total_bbox_area = [], 0.0
    if results and len(results) > 0:
        boxes, names = results[0].boxes, results[0].names
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                class_name = names[int(box.cls[0])]
                if class_name.lower() not in _VALID_WASTE_CLASSES:
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
            "success":             True,
            "has_waste":           False,
            "message":             "No se detectaron residuos válidos",
            "tiempo_inferencia_ms": tiempo_ms,
            "modelo_nombre":       model_name,
        }

    num_detecciones = len(detecciones)
    coverage_ratio  = round(min(total_bbox_area / img_area, 1.0), 4) if img_area > 0 else 0.0
    confianza       = round(sum(d["confidence"] for d in detecciones) / num_detecciones, 4)
    dominant_class  = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
    tipo_residuo    = _V2_CLASS_MAP.get(dominant_class.lower(), "OTRO")

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
        "success":              True,
        "has_waste":            True,
        "nivel_acumulacion":    metricas["nivel"],
        "volumen_estimado_m3":  metricas["volumen"],
        "prioridad":            metricas["prioridad"],
        "tipo_residuo":         tipo_residuo,
        "confianza":            confianza,
        "num_detecciones":      num_detecciones,
        "coverage_ratio":       coverage_ratio,
        "detecciones":          detecciones,
        "scale_penalty_applied": scale_penalty_applied,
        "tiempo_inferencia_ms": tiempo_ms,
        "modelo_nombre":        model_name,
    }
