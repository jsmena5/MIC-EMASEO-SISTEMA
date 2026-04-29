"""
Migra las etiquetas del dataset de clase 0 (garbage) a clase 4 (MIXTO).

Recorre train/labels, valid/labels y test/labels dentro de ML/dataset/ y
reemplaza el ID de clase '0' al inicio de cada línea por '4', conservando
intactas las coordenadas del bounding box (x_center, y_center, w, h).

Formato YOLO por línea:
    ANTES → 0 0.531 0.642 0.937 0.545
    DESPUÉS → 4 0.531 0.642 0.937 0.545

Uso:
    python migrar_etiquetas.py              # migración real
    python migrar_etiquetas.py --dry-run    # simulación sin escribir
    python migrar_etiquetas.py --revert     # revierte 4 → 0 (deshacer)

Dependencias: solo librería estándar de Python (no requiere pip install)
"""

import argparse
import sys
from pathlib import Path

# ─── Configuración ────────────────────────────────────────────────────────────

SCRIPT_DIR  = Path(__file__).parent
DATASET_DIR = SCRIPT_DIR / "dataset"
SPLITS      = ["train", "valid", "test"]

OLD_CLASS = "0"
NEW_CLASS = "4"

# ─── Lógica central ───────────────────────────────────────────────────────────


def migrate_file(
    path: Path,
    old_cls: str,
    new_cls: str,
    dry_run: bool,
) -> tuple[int, int, int]:
    """
    Lee el archivo de etiquetas, reemplaza old_cls → new_cls en el primer
    campo de cada línea y sobreescribe el archivo.

    Returns:
        (modified, unchanged, empty_lines)
    """
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    new_lines: list[str] = []
    modified = unchanged = empty_lines = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            new_lines.append("")
            empty_lines += 1
            continue

        parts = stripped.split()
        if len(parts) < 5:
            # Línea malformada — copiar sin tocar para no corromper
            new_lines.append(stripped)
            unchanged += 1
            continue

        if parts[0] == old_cls:
            parts[0] = new_cls
            new_lines.append(" ".join(parts))
            modified += 1
        else:
            new_lines.append(stripped)
            unchanged += 1

    if not dry_run and modified > 0:
        output = "\n".join(new_lines)
        if output and not output.endswith("\n"):
            output += "\n"
        path.write_text(output, encoding="utf-8")

    return modified, unchanged, empty_lines


# ─── Main ─────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migra etiquetas YOLO de clase 0 → 4 (MIXTO) en todo el dataset."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simula la migración sin escribir ningún archivo.",
    )
    parser.add_argument(
        "--revert",
        action="store_true",
        help="Revierte la migración: cambia clase 4 → 0 (para deshacer).",
    )
    args = parser.parse_args()

    if args.revert:
        old_cls, new_cls = NEW_CLASS, OLD_CLASS
        action_label = "REVERTIR (4 → 0)"
    else:
        old_cls, new_cls = OLD_CLASS, NEW_CLASS
        action_label = "MIGRAR (0 → 4)"

    if args.dry_run:
        print(f"[DRY-RUN] Simulando: {action_label}\n")
    else:
        print(f"[INFO] Ejecutando: {action_label}\n")

    total_files    = 0
    total_modified = 0
    total_unchanged = 0
    errors: list[str] = []

    for split in SPLITS:
        labels_dir = DATASET_DIR / split / "labels"

        if not labels_dir.exists():
            print(f"[WARN] No existe: {labels_dir}  — omitiendo split '{split}'.")
            continue

        txt_files = sorted(labels_dir.glob("*.txt"))
        split_modified = 0

        print(f"[{split.upper():5s}] {len(txt_files)} archivos en {labels_dir}")

        for label_path in txt_files:
            try:
                mod, unch, _ = migrate_file(label_path, old_cls, new_cls, args.dry_run)
                total_files    += 1
                total_modified += mod
                total_unchanged += unch
                split_modified += mod

                # Aviso si un archivo tiene líneas con otra clase (no esperada)
                if unch > 0 and not args.dry_run:
                    print(
                        f"  [WARN] {label_path.name}: "
                        f"{unch} línea(s) con clase ≠ '{old_cls}' (no modificadas)"
                    )
            except Exception as exc:
                errors.append(str(label_path))
                print(f"  [ERROR] {label_path.name}: {exc}")

        print(f"         Líneas migradas en {split}: {split_modified}")

    # ─── Resumen final ───────────────────────────────────────────────────────
    print(f"\n{'═' * 57}")
    print(f"  Archivos procesados  : {total_files}")
    print(f"  Anotaciones migradas : {total_modified}  (clase {old_cls} → {new_cls})")
    print(f"  Líneas no tocadas    : {total_unchanged}")
    print(f"  Errores              : {len(errors)}")

    if errors:
        print("  Archivos con error   :")
        for e in errors:
            print(f"    • {e}")

    print(f"{'═' * 57}")

    if args.dry_run:
        print("[DRY-RUN] No se escribió ningún archivo.")
    elif total_modified == 0:
        print(
            f"[WARN] No se modificó ninguna línea. "
            f"¿Ya fue migrado el dataset? Prueba --revert si necesitas deshacer."
        )
    elif not errors:
        verb = "revertida" if args.revert else "completada"
        print(f"[DONE] Migración {verb}: clase {old_cls} → {new_cls}.")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
