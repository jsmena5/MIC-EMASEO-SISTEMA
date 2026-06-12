"""
Convierte etiquetas de segmentacion (poligonos) a bounding boxes YOLO — EMASEO EP
===================================================================================
El dataset contiene archivos del origen "rf0_thesis-yht" exportados en formato
segmentacion (clase x1 y1 x2 y2 ... xN yN). Este script los convierte al
formato de deteccion: clase x_center y_center width height

Algoritmo por linea:
  - 5 columnas  -> ya es bbox, se conserva sin cambios
  - impar >= 7  -> poligono: calcula bbox desde min/max de vertices
  - par o raro  -> linea irrecuperable, se omite y se registra

Uso:
    python ML/fix_polygon_labels.py                          # dry-run (solo reporta)
    python ML/fix_polygon_labels.py --fix                    # aplica los cambios
    python ML/fix_polygon_labels.py --labels dataset/val/labels --fix
"""

import argparse
import sys
from pathlib import Path

VALID_CLASS_IDS = {0, 1, 2, 3, 4}


def polygon_to_bbox(class_id: int, coords: list[float]) -> str | None:
    """Convierte lista de vertices [x1,y1,x2,y2,...] a linea YOLO bbox."""
    if len(coords) < 6 or len(coords) % 2 != 0:
        return None

    xs = coords[0::2]
    ys = coords[1::2]

    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    x_center = (x_min + x_max) / 2
    y_center = (y_min + y_max) / 2
    width    = x_max - x_min
    height   = y_max - y_min

    # Clamp a [0.0001, 1.0] para evitar coordenadas degeneradas
    x_center = max(0.0001, min(1.0, x_center))
    y_center = max(0.0001, min(1.0, y_center))
    width    = max(0.0001, min(1.0, width))
    height   = max(0.0001, min(1.0, height))

    return f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"


def process_file(path: Path, dry_run: bool) -> tuple[bool, list[str]]:
    """
    Procesa un archivo de etiquetas.
    Retorna (modificado, advertencias).
    """
    warnings = []

    try:
        raw_lines = path.read_text(encoding="utf-8").splitlines()
    except Exception as exc:
        return False, [f"No se pudo leer: {exc}"]

    output_lines = []
    changed = False

    for lineno, raw in enumerate(raw_lines, start=1):
        line = raw.strip()
        if not line:
            continue

        parts = line.split()

        # Linea ya correcta
        if len(parts) == 5:
            output_lines.append(line)
            continue

        # Intentar parsear como poligono
        try:
            class_id = int(parts[0])
            coords   = [float(p) for p in parts[1:]]
        except ValueError:
            warnings.append(f"  linea {lineno}: valor no numerico, omitida -> '{raw[:60]}...'")
            continue

        if class_id not in VALID_CLASS_IDS:
            warnings.append(f"  linea {lineno}: clase invalida ({class_id}), omitida")
            continue

        if len(coords) % 2 != 0 or len(coords) < 6:
            warnings.append(
                f"  linea {lineno}: {len(parts)} columnas no interpretables, omitida"
            )
            continue

        bbox_line = polygon_to_bbox(class_id, coords)
        if bbox_line is None:
            warnings.append(f"  linea {lineno}: conversion fallida, omitida")
            continue

        output_lines.append(bbox_line)
        changed = True

    if changed and not dry_run:
        path.write_text("\n".join(output_lines) + "\n", encoding="utf-8")

    return changed, warnings


def main(labels_dir: Path, dry_run: bool) -> None:
    if not labels_dir.exists():
        print(f"[ERROR] Directorio no encontrado: {labels_dir}", file=sys.stderr)
        sys.exit(1)

    label_files = sorted(labels_dir.glob("*.txt"))
    if not label_files:
        print(f"[WARN] No se encontraron archivos .txt en: {labels_dir}")
        sys.exit(0)

    mode = "DRY-RUN (sin cambios)" if dry_run else "APLICANDO CAMBIOS"
    print(f"Modo     : {mode}")
    print(f"Directorio: {labels_dir}")
    print(f"Archivos : {len(label_files):,}")
    print()

    fixed_count   = 0
    warning_files = []

    for path in label_files:
        changed, warnings = process_file(path, dry_run)
        if changed:
            fixed_count += 1
        if warnings:
            warning_files.append((path.name, warnings))

    # Resumen
    sep = "-" * 72
    print(sep)
    action = "Se convertirian" if dry_run else "Convertidos"
    print(f"  {action}: {fixed_count:,} archivos de {len(label_files):,}")
    print(f"  Sin cambios  : {len(label_files) - fixed_count:,} archivos")

    if warning_files:
        print(f"  Advertencias : {len(warning_files)} archivo(s) con lineas irrecuperables")
        print(sep)
        for fname, warns in warning_files[:20]:   # muestra maximo 20
            print(f"\n[WARN] {fname}")
            for w in warns:
                print(w)
        if len(warning_files) > 20:
            print(f"\n... y {len(warning_files) - 20} archivo(s) mas con advertencias.")

    print(sep)

    if dry_run and fixed_count > 0:
        print()
        print("Para aplicar la conversion ejecuta:")
        print("    python ML/fix_polygon_labels.py --fix")
        print("    python ML/fix_polygon_labels.py --labels dataset/val/labels --fix")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Convierte etiquetas de poligono a bounding box YOLO."
    )
    parser.add_argument(
        "--labels",
        type=Path,
        default=Path("dataset/train/labels"),
        help="Carpeta de etiquetas (default: dataset/train/labels)",
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Aplica los cambios. Sin este flag solo reporta (dry-run).",
    )
    args = parser.parse_args()
    main(args.labels, dry_run=not args.fix)
