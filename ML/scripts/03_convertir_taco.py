"""Convierte TACO (COCO JSON) a formato YOLO (clase 0 = garbage)."""
import json
import shutil
from pathlib import Path

TACO_DIR  = Path(__file__).parent.parent / "datasets_raw" / "taco"
OUT_DIR   = Path(__file__).parent.parent / "datasets_raw" / "taco_yolo"
ANN_FILE  = TACO_DIR / "data" / "annotations.json"

if not ANN_FILE.exists():
    raise FileNotFoundError(f"No se encontro {ANN_FILE}. Ejecuta primero 01_descargar_taco.py")

imgs_out   = OUT_DIR / "images"
labels_out = OUT_DIR / "labels"
imgs_out.mkdir(parents=True, exist_ok=True)
labels_out.mkdir(parents=True, exist_ok=True)

with open(ANN_FILE, encoding="utf-8") as f:
    coco = json.load(f)

img_map = {img["id"]: img for img in coco["images"]}
convertidas = 0
descartadas = 0

for ann in coco["annotations"]:
    img  = img_map[ann["image_id"]]
    W, H = img["width"], img["height"]
    x, y, w, h = ann["bbox"]

    cx = (x + w / 2) / W
    cy = (y + h / 2) / H
    wn = w / W
    hn = h / H

    if not (0 < cx < 1 and 0 < cy < 1 and 0 < wn <= 1 and 0 < hn <= 1):
        descartadas += 1
        continue

    stem = Path(img["file_name"]).stem
    with open(labels_out / f"{stem}.txt", "a") as lf:
        lf.write(f"0 {cx:.6f} {cy:.6f} {wn:.6f} {hn:.6f}\n")
    convertidas += 1

# Copiar imagenes que tienen al menos 1 anotacion valida
copiadas = 0
for img_info in coco["images"]:
    stem = Path(img_info["file_name"]).stem
    label_path = labels_out / f"{stem}.txt"
    src = TACO_DIR / "data" / img_info["file_name"]
    if label_path.exists() and src.exists():
        shutil.copy2(src, imgs_out / src.name)
        copiadas += 1

print(f"[OK] TACO convertido:")
print(f"     Anotaciones convertidas: {convertidas:,}")
print(f"     Anotaciones descartadas: {descartadas:,}")
print(f"     Imagenes copiadas:       {copiadas:,}")
print(f"     Salida: {OUT_DIR}")
