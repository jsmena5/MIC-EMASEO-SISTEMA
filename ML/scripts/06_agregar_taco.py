"""
Convierte TACO (COCO->YOLO) y agrega sus imagenes al dataset_entrenamiento existente.
Usa batch_N + filename como stem para evitar colisiones entre batches.
"""
import json
import shutil
import random
from pathlib import Path

ML_DIR   = Path(__file__).parent.parent
TACO_DIR = ML_DIR / "datasets_raw" / "taco"
OUT_DIR  = ML_DIR / "datasets_raw" / "taco_yolo"
ANN_FILE = TACO_DIR / "data" / "annotations.json"
SALIDA   = ML_DIR / "dataset_entrenamiento"

IMG_EXTS = {".jpg", ".jpeg", ".png"}

# --- Paso 1: Convertir TACO COCO -> YOLO con stems unicos ---
print("[INFO] Convirtiendo TACO COCO -> YOLO (con stems unicos por batch)...")

if not ANN_FILE.exists():
    raise FileNotFoundError(f"No se encontro {ANN_FILE}")

imgs_out   = OUT_DIR / "images"
labels_out = OUT_DIR / "labels"
imgs_out.mkdir(parents=True, exist_ok=True)
labels_out.mkdir(parents=True, exist_ok=True)

with open(ANN_FILE, encoding="utf-8") as f:
    coco = json.load(f)

img_map = {img["id"]: img for img in coco["images"]}

# Construir stem unico: reemplaza "/" y "\" por "_", quita extension
def unique_stem(file_name: str) -> str:
    return Path(file_name).with_suffix("").as_posix().replace("/", "_").replace("\\", "_")

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

    stem = unique_stem(img["file_name"])
    with open(labels_out / f"{stem}.txt", "a") as lf:
        lf.write(f"0 {cx:.6f} {cy:.6f} {wn:.6f} {hn:.6f}\n")
    convertidas += 1

# Copiar imagenes que tienen label valido
copiadas = 0
for img_info in coco["images"]:
    stem = unique_stem(img_info["file_name"])
    label_path = labels_out / f"{stem}.txt"
    src = TACO_DIR / "data" / img_info["file_name"]
    if label_path.exists() and src.exists():
        shutil.copy2(src, imgs_out / (stem + src.suffix))
        copiadas += 1

print(f"[OK] TACO convertido: {convertidas:,} anotaciones, {copiadas:,} imagenes unicas")

# --- Paso 2: Split 85/15 y agregar al dataset ---
all_imgs = [f for f in imgs_out.iterdir() if f.suffix in IMG_EXTS]
random.seed(42)
random.shuffle(all_imgs)
cut = int(len(all_imgs) * 0.85)
splits = {"train": all_imgs[:cut], "valid": all_imgs[cut:]}

total_added = {"train": 0, "valid": 0}

for split, imgs in splits.items():
    out_imgs_dir   = SALIDA / split / "images"
    out_labels_dir = SALIDA / split / "labels"
    out_imgs_dir.mkdir(parents=True, exist_ok=True)
    out_labels_dir.mkdir(parents=True, exist_ok=True)

    for img_path in imgs:
        label_path = labels_out / (img_path.stem + ".txt")
        if not label_path.exists():
            continue
        nuevo_nombre = f"taco_{img_path.name}"
        nuevo_label  = f"taco_{img_path.stem}.txt"
        shutil.copy2(img_path,   out_imgs_dir   / nuevo_nombre)
        shutil.copy2(label_path, out_labels_dir / nuevo_label)
        total_added[split] += 1

print(f"[OK] TACO agregado:")
print(f"     Train: +{total_added['train']:,}")
print(f"     Valid: +{total_added['valid']:,}")

# Actualizar data.yaml
train_total = sum(1 for f in (SALIDA / "train" / "images").iterdir() if f.suffix in IMG_EXTS)
valid_total = sum(1 for f in (SALIDA / "valid" / "images").iterdir() if f.suffix in IMG_EXTS)

yaml = f"""# Dataset EMASEO -- Quito Garbage Detection
path: .
train: train/images
val:   valid/images
test:  test/images
nc: 1
names:
  - garbage

# Train: {train_total:,} imagenes
# Valid: {valid_total:,} imagenes
# Test:  pendiente (Fase 2 -- fotos de Quito)
"""
(SALIDA / "data.yaml").write_text(yaml, encoding="utf-8")

print(f"\n[RESUMEN FINAL]")
print(f"  Train total: {train_total:,}")
print(f"  Valid total: {valid_total:,}")
print(f"  Dataset listo en: {SALIDA.resolve()}")
