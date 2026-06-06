"""
extract_labeled_features.py
─────────────────────────────────────────────────────────────────────────────
Genera/actualiza tests/fixtures/labeled_cases.json corriendo el pipeline PESADO
real (RT-DETR + coverage_union + garbage_score) sobre una carpeta de imágenes
reales etiquetadas. Las features extraídas (cobertura, bboxes, garbage_score,
confianza, tipo) alimentan el harness rápido test_labeled_images.py, que corre
en CI sin torch.

Separamos la extracción cara (puntual, requiere modelo) de la aserción barata
(cada push, lógica pura): así el set etiquetado refleja el comportamiento real
del modelo pero los tests siguen siendo ligeros.

Etiquetas: un JSON { "<archivo>.jpg": {"expected_nivel": "ALTO", "note": "..."} }.
  expected_nivel ∈ BAJO | MEDIO | ALTO | CRITICO | RECHAZADO

Uso (local, con ultralytics + torch + el modelo .pt):
    cd Backend/ml-service
    ML_MODEL_PATH=./modelos/rtdetr_l_best.pt \
        python scripts/extract_labeled_features.py \
            --images tests/fixtures/images \
            --labels tests/fixtures/labels.json \
            --out tests/fixtures/labeled_cases.json

Uso (dentro del contenedor ml-worker, que ya tiene el modelo):
    docker compose exec ml-worker python scripts/extract_labeled_features.py \
        --images /app/tests/fixtures/images --labels /app/tests/fixtures/labels.json
"""

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

# ── Constantes de detección — ESPEJO de tasks.py (mantener en sync) ───────────
# Viven en tasks.py (módulo Celery, no importable sin broker en algunos entornos).
# Si cambian allí, actualizarlas aquí para que la extracción coincida con prod.
NMS_CONF            = 0.60
NMS_IOU             = 0.50
MIN_BBOX_AREA_RATIO = 0.010

_IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def _detect(model, img, img_w, img_h, valid_aliases):
    """Reproduce el filtrado de detecciones de run_inference (tasks.py)."""
    min_bbox_area = MIN_BBOX_AREA_RATIO * img_w * img_h
    results = model.predict(img, conf=NMS_CONF, iou=NMS_IOU, verbose=False)
    detecciones = []
    if results and len(results) > 0:
        boxes, names = results[0].boxes, results[0].names
        if boxes is not None and len(boxes) > 0:
            for box in boxes:
                class_name = names[int(box.cls[0])]
                if class_name.lower() not in valid_aliases:
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--images", required=True, help="Carpeta con imágenes etiquetadas")
    parser.add_argument("--labels", required=True, help="JSON { archivo: {expected_nivel, note} }")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent
                                             / "tests" / "fixtures" / "labeled_cases.json"))
    args = parser.parse_args()

    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here.parent))  # raíz del ml-service

    try:
        from ultralytics import RTDETR
        from PIL import Image
    except ImportError:
        print("ERROR: ultralytics/Pillow no instalados. Ejecuta dentro del ml-worker.")
        return 2

    from config_classes import VALID_ALIASES, ALIAS_MAP
    from ml_utils import coverage_union, compute_garbage_score, GARBAGE_SCORE_HARD_FLOOR

    images_dir = Path(args.images)
    labels = json.loads(Path(args.labels).read_text(encoding="utf-8"))

    model_path = Path(os.environ.get("ML_MODEL_PATH", "/app/models/rtdetr_l_best.pt"))
    print(f"[extract] Cargando modelo: {model_path}")
    model = RTDETR(str(model_path))

    cases = []
    for fname, meta in labels.items():
        img_path = images_dir / fname
        if not img_path.exists() or img_path.suffix.lower() not in _IMG_EXTS:
            print(f"[extract] SKIP {fname}: no encontrado o no es imagen")
            continue

        img = Image.open(img_path).convert("RGB")
        img_w, img_h = img.size
        dets = _detect(model, img, img_w, img_h, VALID_ALIASES)

        if not dets:
            coverage, confianza, tipo, garbage_score, bboxes = 0.0, 0.0, "OTRO", 0.0, []
        else:
            coverage      = coverage_union(dets, img_w, img_h)
            confianza     = round(sum(d["confidence"] for d in dets) / len(dets), 4)
            dominant      = Counter(d["class"] for d in dets).most_common(1)[0][0]
            tipo          = ALIAS_MAP.get(dominant.lower(), "OTRO")
            garbage_score = compute_garbage_score(img, dets, img_w, img_h)
            bboxes        = [d["bbox"] for d in dets]

        case = {
            "name":            Path(fname).stem,
            "note":            meta.get("note", ""),
            "source":          "extracted",
            "image":           fname,
            "img_w":           img_w,
            "img_h":           img_h,
            "bboxes":          bboxes,
            "confianza":       confianza,
            "garbage_score":   garbage_score,
            "tipo_residuo":    tipo,
            "expected_nivel":  meta["expected_nivel"],
        }
        cases.append(case)
        gate = " (RECHAZADO por hard floor)" if garbage_score < GARBAGE_SCORE_HARD_FLOOR else ""
        print(f"[extract] {fname}: n_dets={len(bboxes)} cov={coverage:.3f} "
              f"score={garbage_score:.3f} tipo={tipo} → esperado={meta['expected_nivel']}{gate}")

    out_path = Path(args.out)
    payload = {
        "_README": [
            "GENERADO por scripts/extract_labeled_features.py (source='extracted').",
            "Refrescar cuando cambie el modelo o el preprocesamiento.",
            "Consumido por tests/test_labeled_images.py (clasificación pura, sin torch).",
        ],
        "cases": cases,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[extract] {len(cases)} casos escritos en {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
