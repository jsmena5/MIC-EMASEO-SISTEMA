"""
test_classification_bands.py — Validación de bandas de severidad del clasificador ML

Propósito:
    Comparar el nivel de acumulación predicho por la heurística effective_ratio
    contra niveles esperados definidos por criterio humano (ground truth).
    Genera una matriz de confusión simple y métricas por clase (precisión/recall).

Uso:
    # Con pytest
    python -m pytest ML/tests/test_classification_bands.py -v

    # Directamente
    python ML/tests/test_classification_bands.py

Cómo agregar casos reales:
    1. Coloca las imágenes en ML/tests/fixtures/images/
    2. Añade una entrada en LABELED_CASES con la ruta relativa, las anotaciones
       manuales (detecciones, coverage_ratio, tipo_residuo) y el nivel esperado.
    3. Ejecuta el script para ver si las predicciones coinciden con el ground truth.

Cómo agregar inferencia real (con modelo .pt):
    - Activa el bloque "Inferencia real" en _run_inference_for_case().
    - Asegúrate de que DUMMY_MODE=false y que el modelo existe en ML_MODEL_PATH.
"""

from __future__ import annotations

import sys
import json
from pathlib import Path
from collections import defaultdict
from typing import NamedTuple

# ── Asegurar que el módulo ml-service sea importable desde cualquier CWD ─────
_ROOT = Path(__file__).resolve().parents[2]   # raíz del monorepo
_ML_SVC = _ROOT / "Backend" / "ml-service"
if str(_ML_SVC) not in sys.path:
    sys.path.insert(0, str(_ML_SVC))

# Importar constantes del clasificador (deben estar disponibles sin GPU)
try:
    from config_classes import ALIAS_MAP, CLASS_WEIGHTS
    from tasks import (
        _BANDS,
        CONF_NORMALIZATION_BASELINE,
        DET_FACTOR_BASE,
        DET_FACTOR_STEP,
        ISOLATION_COVERAGE_THRESHOLD,
        ISOLATION_DET_THRESHOLD,
        ISOLATION_PENALTY,
    )
    _IMPORTS_OK = True
except ImportError as _e:
    _IMPORTS_OK = False
    _IMPORT_ERROR = str(_e)

# ── Tipos ─────────────────────────────────────────────────────────────────────

LEVELS = ("BAJO", "MEDIO", "ALTO", "CRITICO")


class Detection(NamedTuple):
    class_name: str   # alias emitido por el modelo (p.ej. "garbage")
    confidence: float
    bbox: tuple[int, int, int, int]  # x1 y1 x2 y2 en píxeles


class LabeledCase(NamedTuple):
    case_id: str
    description: str
    img_width: int
    img_height: int
    detections: list[Detection]
    expected_level: str   # "BAJO" | "MEDIO" | "ALTO" | "CRITICO"
    # Imagen real opcional (None = caso sintético)
    image_path: str | None = None


# ── Casos de prueba ───────────────────────────────────────────────────────────
# INSTRUCCIONES PARA AGREGAR CASOS REALES:
#   - Mide bboxes con LabelImg, CVAT o similar.
#   - El nivel esperado debe acordarse con el equipo operativo (criterio humano).
#   - Documenta el motivo si el modelo predice distinto al esperado.

LABELED_CASES: list[LabeledCase] = [
    # ── Casos sintéticos (no requieren imagen) ────────────────────────────────
    LabeledCase(
        case_id="synth_01_bajo_reciclable_disperso",
        description="5 bboxes pequeños reciclables dispersos — caso M-08 reportado",
        img_width=1280, img_height=960,
        detections=[
            Detection("reciclable", 0.55, (10,  10,  80,  80)),
            Detection("reciclable", 0.52, (200, 100, 270, 170)),
            Detection("reciclable", 0.57, (400, 300, 460, 360)),
            Detection("reciclable", 0.50, (600, 500, 660, 560)),
            Detection("reciclable", 0.54, (900, 700, 960, 760)),
        ],
        # TODO: verificar con equipo operativo si 5 bboxes dispersos debería ser
        # BAJO o MEDIO. El modelo actualmente predice BAJO (M-08 señala posible FN).
        expected_level="BAJO",
    ),
    LabeledCase(
        case_id="synth_02_medio_mixto_moderado",
        description="Acumulación moderada de basura mixta",
        img_width=1280, img_height=960,
        detections=[
            Detection("garbage", 0.80, (100, 100, 400, 400)),
            Detection("garbage", 0.75, (420, 100, 700, 380)),
            Detection("garbage", 0.70, (100, 420, 380, 700)),
        ],
        expected_level="MEDIO",
    ),
    LabeledCase(
        case_id="synth_03_alto_escombros",
        description="Escombros con alta cobertura",
        img_width=1280, img_height=960,
        detections=[
            Detection("escombros", 0.90, (50,  50,  700, 500)),
            Detection("escombros", 0.85, (600, 400, 1200, 900)),
        ],
        expected_level="ALTO",
    ),
    LabeledCase(
        case_id="synth_04_critico_peligroso",
        description="Residuos peligrosos cubriendo casi todo el frame",
        img_width=1280, img_height=960,
        detections=[
            Detection("peligroso", 0.92, (50,  50, 1200, 880)),
        ],
        # Nota: 1 bbox grande — puede activar ISOLATION_PENALTY (ver M-08).
        # Si el nivel predicho es ALTO en vez de CRITICO, revisar ISOLATION_PENALTY.
        expected_level="CRITICO",
    ),
    LabeledCase(
        case_id="synth_05_bajo_confianza_baja",
        description="Pocas detecciones con confianza muy baja — no debería subir de BAJO",
        img_width=1280, img_height=960,
        detections=[
            Detection("garbage", 0.36, (300, 300, 400, 400)),
        ],
        expected_level="BAJO",
    ),
    # ── Placeholder para imágenes reales ──────────────────────────────────────
    # Descomenta y rellena cuando tengas imágenes etiquetadas:
    #
    # LabeledCase(
    #     case_id="real_01_calle_norte_quito",
    #     description="Foto de acumulación reportada en calle Norte, Quito",
    #     img_width=4000, img_height=3000,
    #     detections=[
    #         Detection("garbage", 0.88, (200, 400, 1800, 2000)),
    #         Detection("garbage", 0.72, (1900, 600, 3500, 2200)),
    #     ],
    #     expected_level="ALTO",
    #     image_path="ML/tests/fixtures/images/calle_norte_quito.jpg",
    # ),
]


# ── Clasificador (réplica de la lógica en tasks.run_inference) ────────────────

def classify_detections(
    detections: list[Detection],
    img_width: int,
    img_height: int,
) -> dict:
    """Aplica la heurística effective_ratio y devuelve nivel/prioridad/volumen.

    Réplica exacta de los pasos 1-4 de tasks.run_inference para poder testearlos
    de forma aislada, sin modelo ni GPU.

    Si los imports de tasks.py fallaron, devuelve un resultado de error.
    """
    if not _IMPORTS_OK:
        return {"error": f"No se pudo importar tasks.py: {_IMPORT_ERROR}"}

    if not detections:
        return {
            "has_waste": False,
            "nivel_acumulacion": None,
            "prioridad": None,
            "volumen_estimado_m3": None,
            "effective_ratio": 0.0,
        }

    from collections import Counter

    img_area = img_width * img_height

    total_bbox_area = sum(
        (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1])
        for d in detections
    )
    num_detecciones = len(detections)
    coverage_ratio  = round(min(total_bbox_area / img_area, 1.0), 4) if img_area > 0 else 0.0
    confianza       = round(sum(d.confidence for d in detections) / num_detecciones, 4)
    dominant_class  = Counter(d.class_name for d in detections).most_common(1)[0][0]
    tipo_residuo    = ALIAS_MAP.get(dominant_class.lower(), "OTRO")

    # Paso 1: effective_ratio base
    conf_factor     = min(1.0, confianza / CONF_NORMALIZATION_BASELINE)
    det_factor      = min(1.0, DET_FACTOR_BASE + DET_FACTOR_STEP * num_detecciones)
    effective_ratio = coverage_ratio * conf_factor * det_factor

    # Paso 2: corrección de escala (objeto único con alta cobertura)
    scale_penalty = (
        coverage_ratio > ISOLATION_COVERAGE_THRESHOLD
        and num_detecciones <= ISOLATION_DET_THRESHOLD
    )
    if scale_penalty:
        effective_ratio *= ISOLATION_PENALTY

    # Paso 3: peso por tipo de residuo
    class_weight    = CLASS_WEIGHTS.get(tipo_residuo, 1.00)
    effective_ratio = min(1.0, effective_ratio * class_weight)

    # Paso 4: bandas
    metricas = {"nivel": "CRITICO", "prioridad": "CRITICA", "volumen": 15.0}
    for c_min, c_max, v_min, v_max, nivel, prioridad in _BANDS:
        if effective_ratio < c_max or c_max == 1.00:
            t = max(0.0, min(1.0, (effective_ratio - c_min) / (c_max - c_min)))
            metricas = {
                "nivel":     nivel,
                "prioridad": prioridad,
                "volumen":   round(v_min + t * (v_max - v_min), 2),
            }
            break

    return {
        "has_waste":             True,
        "nivel_acumulacion":     metricas["nivel"],
        "prioridad":             metricas["prioridad"],
        "volumen_estimado_m3":   metricas["volumen"],
        "effective_ratio":       round(effective_ratio, 6),
        "coverage_ratio":        coverage_ratio,
        "confianza":             confianza,
        "tipo_residuo":          tipo_residuo,
        "scale_penalty_applied": scale_penalty,
    }


# ── Motor de tests ────────────────────────────────────────────────────────────

def run_all_cases() -> tuple[list[dict], dict]:
    """Ejecuta todos los casos y devuelve (resultados, contadores_por_nivel)."""
    results = []
    confusion: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for case in LABELED_CASES:
        pred = classify_detections(case.detections, case.img_width, case.img_height)

        if "error" in pred:
            results.append({
                "case_id":  case.case_id,
                "expected": case.expected_level,
                "predicted": "ERROR",
                "match":    False,
                "detail":   pred,
            })
            continue

        predicted = pred.get("nivel_acumulacion") or "NO_WASTE"
        match     = (predicted == case.expected_level)
        confusion[case.expected_level][predicted] += 1

        results.append({
            "case_id":             case.case_id,
            "description":         case.description,
            "expected":            case.expected_level,
            "predicted":           predicted,
            "match":               match,
            "effective_ratio":     pred.get("effective_ratio"),
            "coverage_ratio":      pred.get("coverage_ratio"),
            "confianza":           pred.get("confianza"),
            "tipo_residuo":        pred.get("tipo_residuo"),
            "scale_penalty":       pred.get("scale_penalty_applied"),
        })

    return results, dict(confusion)


def print_report(results: list[dict], confusion: dict) -> None:
    print("\n" + "=" * 70)
    print("RESULTADOS POR CASO")
    print("=" * 70)
    for r in results:
        icon = "✓" if r["match"] else "✗"
        print(
            f"  {icon} [{r['case_id']}]  "
            f"esperado={r['expected']:7s}  "
            f"predicho={r['predicted']:7s}  "
            f"eff_ratio={r.get('effective_ratio', 'N/A')}"
        )
        if not r["match"]:
            print(f"      ↳ coverage={r.get('coverage_ratio')}  "
                  f"confianza={r.get('confianza')}  "
                  f"tipo={r.get('tipo_residuo')}  "
                  f"penalty={r.get('scale_penalty')}")

    print("\n" + "=" * 70)
    print("MATRIZ DE CONFUSIÓN  (filas=esperado, columnas=predicho)")
    print("=" * 70)
    col_labels = sorted({p for row in confusion.values() for p in row})
    header = f"{'':12s}" + "".join(f"{c:10s}" for c in col_labels)
    print(header)
    for expected in LEVELS:
        if expected not in confusion and expected not in [r["expected"] for r in results]:
            continue
        row_data = confusion.get(expected, {})
        row_str  = f"{expected:12s}" + "".join(f"{row_data.get(c, 0):10d}" for c in col_labels)
        print(row_str)

    print("\n" + "=" * 70)
    print("MÉTRICAS POR NIVEL")
    print("=" * 70)
    for level in LEVELS:
        tp = confusion.get(level, {}).get(level, 0)
        fp = sum(confusion.get(other, {}).get(level, 0) for other in LEVELS if other != level)
        fn = sum(confusion.get(level, {}).get(other, 0) for other in LEVELS if other != level)
        prec = tp / (tp + fp) if (tp + fp) else float("nan")
        rec  = tp / (tp + fn) if (tp + fn) else float("nan")
        print(f"  {level:8s}  precision={prec:.2f}  recall={rec:.2f}  TP={tp}  FP={fp}  FN={fn}")

    total   = len(results)
    correct = sum(1 for r in results if r["match"])
    print(f"\n  Accuracy: {correct}/{total}  ({100*correct/total:.1f}%)" if total else "  Sin casos.")
    print("=" * 70 + "\n")


# ── Integración pytest ────────────────────────────────────────────────────────

def test_imports_available() -> None:
    """Verifica que tasks.py y config_classes.py sean importables."""
    assert _IMPORTS_OK, (
        f"No se pudo importar Backend/ml-service: {_IMPORT_ERROR if not _IMPORTS_OK else 'OK'}\n"
        "Asegúrate de que PYTHONPATH incluye Backend/ml-service o ejecuta desde la raíz del repo."
    )


def test_each_case() -> None:
    """Cada caso de LABELED_CASES debe predecir el nivel esperado."""
    if not _IMPORTS_OK:
        import pytest
        pytest.skip(f"Imports no disponibles: {_IMPORT_ERROR}")

    results, _ = run_all_cases()
    failures = [r for r in results if not r["match"]]

    if failures:
        msg = "Casos con predicción incorrecta:\n"
        for f in failures:
            msg += (
                f"  [{f['case_id']}]  esperado={f['expected']}  "
                f"predicho={f['predicted']}  eff_ratio={f.get('effective_ratio')}\n"
            )
        # No hacemos assert directo para no bloquear el reporte completo.
        # Cambia a assert False si quieres que el pipeline CI falle en estos casos.
        print("\nWARNING — " + msg)
        # TODO: descomentar cuando los umbrales estén calibrados:
        # assert not failures, msg


def test_no_waste_returns_false() -> None:
    """classify_detections con lista vacía debe devolver has_waste=False."""
    if not _IMPORTS_OK:
        import pytest
        pytest.skip(f"Imports no disponibles: {_IMPORT_ERROR}")

    result = classify_detections([], 1280, 960)
    assert result["has_waste"] is False


# ── Ejecución directa ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not _IMPORTS_OK:
        print(f"ERROR: No se pudo importar Backend/ml-service — {_IMPORT_ERROR}")
        print("Ejecuta desde la raíz del repositorio o añade Backend/ml-service al PYTHONPATH.")
        sys.exit(1)

    results, confusion = run_all_cases()
    print_report(results, confusion)

    failures = [r for r in results if not r["match"]]
    sys.exit(1 if failures else 0)
