"""
Microservicio de inferencia RT-DETR-L para EMASEO
Puerto: 8000

Ejecutar:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import base64
import io
import os
import time
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from PIL import Image

# ── Configuración del modelo ───────────────────────────────────────────────────
# Ruta relativa desde este archivo: Backend/ml-service/ → raíz → ML/modelos/
_DEFAULT_MODEL_PATH = Path(__file__).parent.parent.parent / "ML" / "modelos" / "rtdetr_l_best.pt"
MODEL_PATH = Path(os.environ.get("ML_MODEL_PATH", str(_DEFAULT_MODEL_PATH)))

MODEL_NAME = MODEL_PATH.name

# El modelo se carga una sola vez al iniciar el servidor
_model = None


def get_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise RuntimeError(
                f"Modelo no encontrado en: {MODEL_PATH}\n"
                f"Asegúrate de que el archivo rtdetr_l_best.pt existe en ML/modelos/"
            )
        from ultralytics import RTDETR
        print(f"Cargando modelo desde: {MODEL_PATH}")
        _model = RTDETR(str(MODEL_PATH))
        print("Modelo cargado correctamente.")
    return _model


# ── Mapa: nombre de clase del modelo → valor ENUM ai.waste_type en PostgreSQL ──
# Actualizar cuando el modelo sea reentrenado con clases específicas de EMASEO.
CLASS_TO_WASTE_TYPE: dict[str, str] = {
    "garbage":    "MIXTO",
    "basura":     "MIXTO",
    "plastico":   "RECICLABLE",
    "plastic":    "RECICLABLE",
    "organico":   "ORGANICO",
    "organic":    "ORGANICO",
    "escombros":  "ESCOMBROS",
    "debris":     "ESCOMBROS",
    "peligroso":  "PELIGROSO",
    "hazardous":  "PELIGROSO",
    "domestico":  "DOMESTICO",
    "domestic":   "DOMESTICO",
    "reciclable": "RECICLABLE",
    "recyclable": "RECICLABLE",
}
_WASTE_TYPE_FALLBACK = "OTRO"

# Solo se aceptan detecciones cuya clase esté en este whitelist.
# Cualquier clase que el modelo herede de COCO (person, dog, car, etc.)
# se descarta antes de calcular cobertura y volumen.
VALID_WASTE_CLASSES: frozenset[str] = frozenset(CLASS_TO_WASTE_TYPE.keys())

# Umbral mínimo de confianza post-NMS. El modelo puede devolver cajas con
# confianza >= conf_inference (0.40); este filtro adicional eleva el estándar.
CONFIDENCE_THRESHOLD: float = 0.45


def map_class_to_waste_type(class_name: str) -> str:
    """Traduce el nombre de clase del modelo al ENUM ai.waste_type de PostgreSQL."""
    return CLASS_TO_WASTE_TYPE.get(class_name.lower(), _WASTE_TYPE_FALLBACK)


# ── Heurística de estimación ───────────────────────────────────────────────────
# Bandas: (coverage_min, coverage_max, volumen_min, volumen_max, nivel, prioridad)
_BANDS = [
    (0.00, 0.15, 0.1,  0.5,  "BAJO",    "BAJA"),
    (0.15, 0.40, 0.5,  2.0,  "MEDIO",   "MEDIA"),
    (0.40, 0.70, 2.0,  5.0,  "ALTO",    "ALTA"),
    (0.70, 1.00, 5.0, 15.0,  "CRITICO", "CRITICA"),
]


def calcular_nivel_volumen_prioridad(
    coverage_ratio: float,
    num_detecciones: int = 1,
    confianza_media: float = 1.0,
) -> dict:
    """Interpolación lineal dentro de cada banda, corregida por calidad de detección.

    Se aplican dos factores de penalización para reducir falsos positivos de volumen:

    conf_factor  — escala el coverage si la confianza media es baja.
                   Alcanza 1.0 en confianza >= 0.70 (umbral de "detección firme").

    det_factor   — penaliza fotos en primer plano con una sola detección.
                   Con 1 caja recibe 0.60; con 2 recibe 0.80; con 3+ recibe 1.0.
                   Esto evita que un único objeto grande infle el volumen estimado.

    El 'effective_ratio' se usa solo para la heurística de volumen.
    El 'coverage_ratio' original se devuelve en la respuesta sin modificar.
    """
    conf_factor = min(1.0, confianza_media / 0.70)
    det_factor = min(1.0, 0.40 + 0.20 * num_detecciones)
    effective_ratio = coverage_ratio * conf_factor * det_factor

    for c_min, c_max, v_min, v_max, nivel, prioridad in _BANDS:
        if effective_ratio < c_max or c_max == 1.00:
            t = (effective_ratio - c_min) / (c_max - c_min)
            t = max(0.0, min(1.0, t))
            volumen = round(v_min + t * (v_max - v_min), 2)
            return {"nivel": nivel, "prioridad": prioridad, "volumen": volumen}
    return {"nivel": "CRITICO", "prioridad": "CRITICA", "volumen": 15.0}


# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI(title="EMASEO ML Service", version="1.0.0")


class PredictRequest(BaseModel):
    image_base64: str
    image_width: int = 1280
    image_height: int = 960


class Detection(BaseModel):
    class_name: str
    confidence: float
    bbox: list[int]  # [x1, y1, x2, y2]


class PredictResponse(BaseModel):
    has_waste: bool
    nivel_acumulacion: str
    volumen_estimado_m3: float
    prioridad: str
    tipo_residuo: str
    confianza: float
    num_detecciones: int
    coverage_ratio: float
    detecciones: list[dict]
    tiempo_inferencia_ms: int
    modelo_nombre: str


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME, "model_path": str(MODEL_PATH)}


@app.post("/predict")
def predict(req: PredictRequest):
    # 1. Decodificar imagen
    try:
        img_bytes = base64.b64decode(req.image_base64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Imagen base64 inválida: {str(e)}")

    img_w, img_h = img.size
    img_area = img_w * img_h

    # 2. Inferencia
    model = get_model()
    t_start = time.time()
    # conf=0.40: primer filtro NMS en el modelo (más estricto que el 0.25 por defecto).
    # El segundo filtro (CONFIDENCE_THRESHOLD=0.45) se aplica en el bucle de abajo.
    results = model.predict(img, conf=0.40, verbose=False)
    tiempo_ms = int((time.time() - t_start) * 1000)

    # 3. Procesar detecciones — doble filtro: whitelist de clases + confianza mínima
    detecciones = []
    total_bbox_area = 0.0

    if results and len(results) > 0:
        boxes = results[0].boxes
        names = results[0].names  # dict {0: 'plastico', 1: 'escombros', ...}
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                class_name = names[int(box.cls[0])]
                conf = float(box.conf[0])

                # Descarta clases irrelevantes (perros, personas, coches, etc.)
                if class_name.lower() not in VALID_WASTE_CLASSES:
                    continue
                # Descarta detecciones de baja confianza tras NMS
                if conf < CONFIDENCE_THRESHOLD:
                    continue

                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                bbox_area = (x2 - x1) * (y2 - y1)
                total_bbox_area += bbox_area
                detecciones.append({
                    "class": class_name,
                    "confidence": round(conf, 4),
                    "bbox": [x1, y1, x2, y2]
                })

    # 4. Rechazo amigable: ninguna detección válida tras ambos filtros
    if not detecciones:
        return JSONResponse(content={
            "success": True,
            "has_waste": False,
            "message": "No se detectaron residuos válidos en la imagen",
            "tiempo_inferencia_ms": tiempo_ms,
            "modelo_nombre": MODEL_NAME,
        })

    # 5. Métricas
    num_detecciones = len(detecciones)
    coverage_ratio = round(total_bbox_area / img_area, 4) if img_area > 0 else 0.0
    confianza = round(
        sum(d["confidence"] for d in detecciones) / num_detecciones, 4
    ) if num_detecciones > 0 else 0.0

    # 6. Clase dominante → tipo de residuo general de la foto
    # La clase más frecuente se traduce al ENUM ai.waste_type de PostgreSQL.
    if detecciones:
        dominant_class = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
        tipo_residuo = map_class_to_waste_type(dominant_class)
    else:
        tipo_residuo = "OTRO"

    # 7. Heurística: nivel, volumen, prioridad (con corrección por calidad)
    metricas = calcular_nivel_volumen_prioridad(coverage_ratio, num_detecciones, confianza)

    return PredictResponse(
        has_waste=True,
        nivel_acumulacion=metricas["nivel"],
        volumen_estimado_m3=metricas["volumen"],
        prioridad=metricas["prioridad"],
        tipo_residuo=tipo_residuo,
        confianza=confianza,
        num_detecciones=num_detecciones,
        coverage_ratio=coverage_ratio,
        detecciones=detecciones,
        tiempo_inferencia_ms=tiempo_ms,
        modelo_nombre=MODEL_NAME,
    )
