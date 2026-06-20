"""
Fusiona dataset europeo + TACO + garbage_detection + street_trash en dataset_entrenamiento/.
Todas las clases se mapean a clase 0 (garbage).
"""
import shutil
import re
from pathlib import Path

ML_DIR = Path(__file__).parent.parent
SALIDA = ML_DIR / "dataset_entrenamiento"

FUENTES_TRAIN = [
    (ML_DIR / "dataset" / "train" / "images",
     ML_DIR / "dataset" / "train" / "labels"),
    (ML_DIR / "datasets_raw" / "taco_yolo" / "images",
     ML_DIR / "datasets_raw" / "taco_yolo" / "labels"),
    (ML_DIR / "datasets_raw" / "garbage_detection" / "train" / "images",
     ML_DIR / "datasets_raw" / "garbage_detection" / "train" / "labels"),
    (ML_DIR / "datasets_raw" / "street_trash" / "train" / "images",
     ML_DIR / "datasets_raw" / "street_trash" / "train" / "labels"),
]

FUENTES_VALID = [
    (ML_DIR / "dataset" / "valid" / "images",
     ML_DIR / "dataset" / "valid" / "labels"),
    (ML_DIR / "datasets_raw" / "garbage_detection" / "valid" / "images",
     ML_DIR / "datasets_raw" / "garbage_detection" / "valid" / "labels"),
    (ML_DIR / "datasets_raw" / "street_trash" / "valid" / "images",
     ML_DIR / "datasets_raw" / "street_trash" / "valid" / "labels"),
]

IMG_EXTS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}


def remap_labels_to_zero(src_label: Path, dst_label: Path) -> bool:
    """Reescribe el label forzando clase 0 en todas las filas."""
    lines = src_label.read_text(encoding="utf-8").splitlines()
    nuevas = []
    for line in lines:
        parts = line.strip().split()
        if len(parts) == 5:
            nuevas.append(f"0 {parts[1]} {parts[2]} {parts[3]} {parts[4]}")
    if nuevas:
        dst_label.write_text("\n".join(nuevas) + "\n", encoding="utf-8")
        return True
    return False


def copiar_split(fuentes, split_nombre):
    out_imgs   = SALIDA / split_nombre / "images"
    out_labels = SALIDA / split_nombre / "labels"
    out_imgs.mkdir(parents=True, exist_ok=True)
    out_labels.mkdir(parents=True, exist_ok=True)

    total = 0
    for imgs_dir, labels_dir in fuentes:
        if not imgs_dir.exists():
            print(f"  [WARN] No encontrado: {imgs_dir} -- saltando")
            continue

        prefijo = re.sub(r"[^a-zA-Z0-9]", "", imgs_dir.parent.parent.name)[:8]
        candidatas = [f for f in imgs_dir.iterdir() if f.suffix in IMG_EXTS]

        for img_path in candidatas:
            label_path = labels_dir / (img_path.stem + ".txt")
            if not label_path.exists():
                continue

            nuevo_stem  = f"{prefijo}_{img_path.stem}"
            nuevo_img   = out_imgs   / (nuevo_stem + img_path.suffix)
            nuevo_label = out_labels / (nuevo_stem + ".txt")

            shutil.copy2(img_path, nuevo_img)
            if not remap_labels_to_zero(label_path, nuevo_label):
                nuevo_img.unlink(missing_ok=True)
                continue
            total += 1

    print(f"  [OK] {split_nombre}: {total:,} imagenes")
    return total


print("\n[INFO] Fusionando datasets...")
t = copiar_split(FUENTES_TRAIN, "train")
v = copiar_split(FUENTES_VALID, "valid")

(SALIDA / "test" / "images").mkdir(parents=True, exist_ok=True)
(SALIDA / "test" / "labels").mkdir(parents=True, exist_ok=True)

yaml_content = f"""# Dataset EMASEO -- Quito Garbage Detection
path: .
train: train/images
val:   valid/images
test:  test/images
nc: 1
names:
  - garbage

# Train: {t:,} imagenes
# Valid: {v:,} imagenes
# Test:  pendiente (Fase 2 -- fotos de Quito)
"""
(SALIDA / "data.yaml").write_text(yaml_content, encoding="utf-8")

print(f"\n[RESUMEN]")
print(f"  Train: {t:,} imagenes")
print(f"  Valid: {v:,} imagenes")
print(f"  Test:  pendiente (Fase 2)")
print(f"\n[INFO] Dataset listo en: {SALIDA.resolve()}")
