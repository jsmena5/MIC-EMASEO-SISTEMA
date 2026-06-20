"""
Genera archivos .txt de 0 bytes para imágenes de fondo en datasets YOLO/RT-DETR.

Las imágenes sin objetos (calles limpias, fondos urbanos) necesitan un .txt vacío
para que el framework las incluya como "background samples". Sin ese archivo la
imagen es ignorada, privando al modelo de la señal de penalización de falsos
positivos más valiosa del entrenamiento.

Estructura esperada del dataset (convención Ultralytics):
    split/
    ├── images/   ← directorio que se pasa como argumento
    └── labels/   ← aquí se crean los .txt vacíos

Uso:
    python create_background_labels.py --images dataset/background/images
    python create_background_labels.py --images dataset/train/images --dry-run
"""

import argparse
from pathlib import Path

_IMAGE_EXTENSIONS: frozenset[str] = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})


def create_background_labels(images_dir: Path, dry_run: bool = False) -> tuple[int, int]:
    """Crea un .txt vacío por cada imagen que no tenga etiqueta.

    Sigue la convención Ultralytics: labels/ es hermano de images/ dentro del
    mismo split (train/valid/test/background).

    Returns:
        (created, skipped) — archivos nuevos creados y omitidos (ya existían).
    """
    labels_dir = images_dir.parent.parent / "labels" / images_dir.name
    if not dry_run:
        labels_dir.mkdir(parents=True, exist_ok=True)

    created = skipped = 0
    for img_path in sorted(images_dir.iterdir()):
        if img_path.suffix.lower() not in _IMAGE_EXTENSIONS:
            continue
        label_path = labels_dir / (img_path.stem + ".txt")
        if label_path.exists():
            skipped += 1
            continue
        if dry_run:
            print(f"[dry-run] crearía: {label_path}")
        else:
            label_path.touch()
        created += 1

    return created, skipped


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Genera .txt vacíos (background samples) para imágenes sin etiquetas."
    )
    parser.add_argument(
        "--images",
        required=True,
        type=Path,
        metavar="DIR",
        help="Directorio de imágenes de fondo (ej. dataset/background/images)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Muestra qué archivos se crearían sin escribir nada en disco",
    )
    args = parser.parse_args()

    if not args.images.is_dir():
        raise SystemExit(f"Error: directorio no encontrado: {args.images}")

    created, skipped = create_background_labels(args.images, dry_run=args.dry_run)
    action = "se crearían" if args.dry_run else "creados"
    print(f"Archivos {action}: {created}  |  omitidos (ya existían): {skipped}")


if __name__ == "__main__":
    main()
