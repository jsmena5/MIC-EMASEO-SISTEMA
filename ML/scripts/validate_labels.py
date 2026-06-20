"""
Sanity-check del dataset YOLO para RT-DETR — EMASEO EP
=======================================================
Recorre ML/dataset/train/labels/ y valida que cada archivo .txt cumpla:
  - IDs de clase: estrictamente en {0, 1, 2, 3, 4}
  - Coordenadas (x_center, y_center, width, height): en (0.0, 1.0]
  - Formato: exactamente 5 columnas por fila, todas numéricas

Uso:
    python ML/validate_labels.py
    python ML/validate_labels.py --labels ML/dataset/val/labels   # otro split
"""

import argparse
import sys
from pathlib import Path

VALID_CLASS_IDS = {0, 1, 2, 3, 4}
COORD_COLS      = ("x_center", "y_center", "width", "height")


def validate_file(path: Path) -> list[str]:
    """Devuelve lista de mensajes de error; vacía si el archivo está limpio."""
    errors = []

    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception as exc:
        return [f"  [LECTURA] No se pudo abrir: {exc}"]

    for lineno, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:          # líneas vacías → ignorar
            continue

        parts = line.split()

        # ── 1. Número de columnas ──────────────────────────────────────────────
        if len(parts) != 5:
            errors.append(
                f"  línea {lineno}: se esperaban 5 columnas, se encontraron {len(parts)} -> '{raw}'"
            )
            continue          # sin suficientes datos para seguir validando esta fila

        # ── 2. Todos los valores deben ser numéricos ───────────────────────────
        try:
            cls_id = int(parts[0])
            coords = [float(p) for p in parts[1:]]
        except ValueError:
            errors.append(
                f"  línea {lineno}: valor no numérico -> '{raw}'"
            )
            continue

        # ── 3. ID de clase ─────────────────────────────────────────────────────
        if cls_id not in VALID_CLASS_IDS:
            errors.append(
                f"  línea {lineno}: clase inválida ({cls_id}) — se permite {{0-4}} -> '{raw}'"
            )

        # ── 4. Coordenadas en rango (0, 1] ─────────────────────────────────────
        for col_name, val in zip(COORD_COLS, coords):
            if not (0.0 < val <= 1.0):
                errors.append(
                    f"  línea {lineno}: {col_name}={val:.6f} fuera de (0, 1] -> '{raw}'"
                )

    return errors


def main(labels_dir: Path) -> None:
    if not labels_dir.exists():
        print(f"[ERROR] Directorio no encontrado: {labels_dir}", file=sys.stderr)
        sys.exit(1)

    label_files = sorted(labels_dir.glob("*.txt"))
    if not label_files:
        print(f"[WARN] No se encontraron archivos .txt en: {labels_dir}")
        sys.exit(0)

    print(f"Validando {len(label_files):,} archivos en: {labels_dir}\n")

    corrupted: list[tuple[Path, list[str]]] = []

    for path in label_files:
        errs = validate_file(path)
        if errs:
            corrupted.append((path, errs))

    # ── Reporte ────────────────────────────────────────────────────────────────
    sep = "-" * 72
    if not corrupted:
        print(sep)
        print(f"  OK - todos los {len(label_files):,} archivos superaron la validacion.")
        print(sep)
        sys.exit(0)

    print(sep)
    print(f"  ARCHIVOS DAÑADOS: {len(corrupted)} de {len(label_files):,}")
    print(sep)

    for path, errs in corrupted:
        print(f"\n[DAÑADO] {path.name}")
        for msg in errs:
            print(msg)

    print(f"\n{sep}")
    print("RESUMEN — rutas completas de archivos a eliminar o corregir:")
    print(sep)
    for path, _ in corrupted:
        print(path)

    print(sep)
    print(
        f"\nTotal: {len(corrupted)} archivo(s) con errores.\n"
        "Elimínalos o corrige sus etiquetas antes de volver a entrenar."
    )
    sys.exit(1)   # código de salida != 0 para que CI/scripts detecten el fallo


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Valida etiquetas YOLO del dataset EMASEO.")
    parser.add_argument(
        "--labels",
        type=Path,
        default=Path("ML/dataset/train/labels"),
        help="Carpeta de etiquetas a validar (default: ML/dataset/train/labels)",
    )
    args = parser.parse_args()
    main(args.labels)
