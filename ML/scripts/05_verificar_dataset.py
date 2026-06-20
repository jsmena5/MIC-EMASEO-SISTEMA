"""Verifica integridad del dataset_entrenamiento: conteos, labels huerfanas, clases."""
from pathlib import Path
import random

BASE = Path(__file__).parent.parent / "dataset_entrenamiento"
IMG_EXTS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}

print(f"\n{'='*50}")
print("  VERIFICACION DE DATASET")
print(f"{'='*50}")

for split in ["train", "valid", "test"]:
    imgs_dir   = BASE / split / "images"
    labels_dir = BASE / split / "labels"

    imgs   = [f for f in imgs_dir.rglob("*") if f.suffix in IMG_EXTS] if imgs_dir.exists() else []
    labels = list(labels_dir.rglob("*.txt")) if labels_dir.exists() else []

    sin_label = [img for img in imgs
                 if not (labels_dir / (img.stem + ".txt")).exists()]
    sin_img   = [lbl for lbl in labels
                 if not any((imgs_dir / (lbl.stem + ext)).exists() for ext in IMG_EXTS)]

    print(f"\n{split.upper()}:")
    print(f"  Imagenes:          {len(imgs):>7,}")
    print(f"  Labels:            {len(labels):>7,}")
    print(f"  Imgs sin label:    {len(sin_label):>7,}")
    print(f"  Labels sin imagen: {len(sin_img):>7,}")

    # Verificar que todas las clases sean 0
    clases_distintas = set()
    sample = random.sample(labels, min(500, len(labels)))
    for lbl in sample:
        for line in lbl.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split()
            if parts:
                clases_distintas.add(int(parts[0]))

    estado = "[OK] solo clase 0" if clases_distintas <= {0} else "[ERROR] revisar clases"
    print(f"  Clases (muestra):  {sorted(clases_distintas)} {estado}")

    if sin_label[:3]:
        print(f"  Ejemplos sin label: {[f.name for f in sin_label[:3]]}")

print(f"\n{'='*50}")
print("  VERIFICACION COMPLETA")
print(f"{'='*50}\n")
