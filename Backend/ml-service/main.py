"""
Microservicio de inferencia RT-DETR-L para EMASEO
Puerto: 8000

Ejecutar:
    uvicorn main:app --host 0.0.0.0 --port 8000
"""

import base64
import io
import os
import random
import time
from collections import Counter
from pathlib import Path

from fastapi import FastAPI, HTTPException
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


def map_class_to_waste_type(class_name: str) -> str:
    """Traduce el nombre de clase del modelo al ENUM ai.waste_type de PostgreSQL."""
    return CLASS_TO_WASTE_TYPE.get(class_name.lower(), _WASTE_TYPE_FALLBACK)


# ── Heurística de estimación ───────────────────────────────────────────────────
def calcular_nivel_volumen_prioridad(coverage_ratio: float) -> dict:
    if coverage_ratio < 0.15:
        nivel = "BAJO"
        prioridad = "BAJA"
        volumen = round(random.uniform(0.1, 0.5), 2)
    elif coverage_ratio < 0.40:
        nivel = "MEDIO"
        prioridad = "MEDIA"
        volumen = round(random.uniform(0.5, 2.0), 2)
    elif coverage_ratio < 0.70:
        nivel = "ALTO"
        prioridad = "ALTA"
        volumen = round(random.uniform(2.0, 5.0), 2)
    else:
        nivel = "CRITICO"
        prioridad = "CRITICA"
        volumen = round(random.uniform(5.0, 15.0), 2)
    return {"nivel": nivel, "prioridad": prioridad, "volumen": volumen}


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


@app.post("/predict", response_model=PredictResponse)
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
    results = model.predict(img, conf=0.25, verbose=False)
    tiempo_ms = int((time.time() - t_start) * 1000)

    # 3. Procesar detecciones
    detecciones = []
    total_bbox_area = 0.0

    if results and len(results) > 0:
        boxes = results[0].boxes
        names = results[0].names  # dict {0: 'plastico', 1: 'escombros', ...}
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                conf = float(box.conf[0])
                class_name = names[int(box.cls[0])]
                bbox_area = (x2 - x1) * (y2 - y1)
                total_bbox_area += bbox_area
                detecciones.append({
                    "class": class_name,
                    "confidence": round(conf, 4),
                    "bbox": [x1, y1, x2, y2]
                })

    # 4. Métricas
    num_detecciones = len(detecciones)
    coverage_ratio = round(total_bbox_area / img_area, 4) if img_area > 0 else 0.0
    confianza = round(
        sum(d["confidence"] for d in detecciones) / num_detecciones, 4
    ) if num_detecciones > 0 else 0.0

    # 5. Clase dominante → tipo de residuo general de la foto
    # La clase más frecuente se traduce al ENUM ai.waste_type de PostgreSQL.
    if detecciones:
        dominant_class = Counter(d["class"] for d in detecciones).most_common(1)[0][0]
        tipo_residuo = map_class_to_waste_type(dominant_class)
    else:
        tipo_residuo = "OTRO"

    # 6. Heurística: nivel, volumen, prioridad
    metricas = calcular_nivel_volumen_prioridad(coverage_ratio)

    # 0 detecciones → nivel mínimo, volumen 0
    if num_detecciones == 0:
        metricas["volumen"] = 0.0

    return PredictResponse(
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
