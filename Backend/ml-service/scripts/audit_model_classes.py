"""
audit_model_classes.py
─────────────────────────────────────────────────────────────────────────────
Audita el modelo RT-DETR cargando los pesos .pt e imprimiendo las clases
entrenadas. Diff vs el registry de config_classes para detectar:

  1. Clases que el modelo emite pero NO están mapeadas → causan falsos
     positivos porque pasan el filtro VALID_ALIASES (si nombre genérico)
     o se descartan silenciosamente (si nombre específico).

  2. Clases del registry que el modelo NUNCA emite → indica que el
     registry está sobre-especificado o el modelo está sub-entrenado.

Uso (dentro del contenedor ml-worker):
    docker compose exec ml-worker python scripts/audit_model_classes.py

Uso local (requiere ultralytics + torch instalados):
    cd Backend/ml-service
    ML_MODEL_PATH=./modelos/rtdetr_l_best.pt python scripts/audit_model_classes.py
"""

import os
import sys
from pathlib import Path


def _header(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def _print_trained_classes(model, alias_map) -> None:
    _header(f"Clases entrenadas en el modelo ({len(model.names)}):")
    for idx, name in sorted(model.names.items()):
        mapped = alias_map.get(name.lower())
        marker = f"→ {mapped}" if mapped else "✗ NO MAPEADA (caerá en OTRO o se descartará)"
        print(f"  [{idx:>3}] {name:<25} {marker}")


def _print_set(title: str, items: set, footer: str, empty: str) -> None:
    _header(f"{title} ({len(items)}):")
    if items:
        for name in sorted(items):
            print(f"  - {name}")
        print(footer)
    else:
        print(empty)


def _print_category_summary(waste_registry, model_classes: set) -> None:
    _header("Resumen por categoría canónica:")
    for wc in waste_registry:
        emitted = [a for a in wc.aliases if a in model_classes]
        status = "✓" if emitted else "✗"
        print(f"  {status} {wc.canonical:<12} aliases={wc.aliases} → emitidos: {emitted or '(ninguno)'}")


def main() -> int:
    # Permitir importar config_classes desde la raíz del ml-service
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here.parent))

    try:
        from ultralytics import RTDETR
    except ImportError:
        print("ERROR: ultralytics no instalado. Ejecuta dentro del contenedor ml-worker.")
        return 2

    from config_classes import WASTE_REGISTRY, VALID_ALIASES, ALIAS_MAP

    model_path = Path(os.environ.get("ML_MODEL_PATH", "/app/models/rtdetr_l_best.pt"))
    if not model_path.exists():
        print(f"ERROR: modelo no encontrado en {model_path}")
        print("Define ML_MODEL_PATH para apuntar a tu .pt local.")
        return 3

    print(f"Cargando modelo: {model_path}")
    model = RTDETR(str(model_path))
    model_classes = {name.lower() for name in model.names.values()}
    registry_aliases = set(VALID_ALIASES)

    _print_trained_classes(model, ALIAS_MAP)

    _print_set(
        "Clases del modelo SIN mapeo en config_classes",
        model_classes - registry_aliases,
        "\n  ⚠ Estas detecciones se DESCARTAN en tasks.py:246 (VALID_ALIASES check)."
        "\n    Si una de estas es realmente basura, agrégala como alias al registry.",
        "  (ninguna)",
    )

    _print_set(
        "Aliases en config_classes que el modelo NUNCA emite",
        registry_aliases - model_classes,
        "\n  ℹ Estos aliases son código muerto en el filtro VALID_ALIASES."
        "\n    Considera removerlos del registry si el modelo no los emite.",
        "  (todos los aliases del registry son emitidos por el modelo)",
    )

    _print_category_summary(WASTE_REGISTRY, model_classes)

    print("\nAuditoría completa.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
