"""
test_labeled_images.py
─────────────────────────────────────────────────────────────────────────────
Harness de regresión basado en un set ETIQUETADO de casos reales conocidos
(tests/fixtures/labeled_cases.json).

Cada caso fija las features de una escena (cobertura derivada de las bboxes,
garbage_score, confianza, tipo) y el nivel de severidad esperado. El test corre
la clasificación REAL (ml_utils.classify_severity) — la misma que producción —
y bloquea regresiones de banda. Es puro y rápido: NO carga torch ni el modelo,
así corre en CI en cada push.

Las features de cada caso se generan una vez con el pipeline pesado real vía
scripts/extract_labeled_features.py (sobre las imágenes reales) y se versionan
en el JSON. Refrescar el fixture cuando cambie el modelo o el preprocesamiento.

Ejecución:
    cd Backend/ml-service
    python -m pytest tests/test_labeled_images.py -v
"""

import json
import sys
from pathlib import Path

import pytest

# Raíz del ml-service en el path para importar ml_utils sin instalación
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml_utils import (
    classify_severity as _classify_severity,
    coverage_union as _coverage_union,
    GARBAGE_SCORE_HARD_FLOOR,
)

_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "labeled_cases.json"

_VALID_NIVELES = {"BAJO", "MEDIO", "ALTO", "CRITICO", "RECHAZADO"}


def _load_cases() -> list:
    with _FIXTURE.open(encoding="utf-8") as fh:
        data = json.load(fh)
    return data["cases"]


def _resolve_nivel(case: dict) -> str:
    """Reproduce el flujo de run_inference para un caso etiquetado.

    1. Gate 1b: si garbage_score < HARD_FLOOR → 'RECHAZADO' (has_waste=false).
    2. Si no, clasifica con classify_severity y devuelve el nivel de acumulación.

    La cobertura y el número de detecciones se derivan de las bboxes del caso para
    mantener el fixture internamente consistente.
    """
    img_w, img_h = case["img_w"], case["img_h"]
    detecciones = [{"bbox": b, "class": "garbage", "confidence": case["confianza"]}
                   for b in case["bboxes"]]
    garbage_score = case["garbage_score"]

    if garbage_score < GARBAGE_SCORE_HARD_FLOOR:
        return "RECHAZADO"

    coverage = _coverage_union(detecciones, img_w, img_h)
    result = _classify_severity(
        coverage_ratio=coverage,
        confianza=case["confianza"],
        num_detecciones=len(detecciones),
        garbage_score=garbage_score,
        tipo_residuo=case["tipo_residuo"],
        detecciones=detecciones,
        img_w=img_w,
        img_h=img_h,
    )
    return result["nivel"]


_CASES = _load_cases()


def test_fixture_is_well_formed():
    """El JSON tiene al menos un caso y todos declaran un nivel esperado válido."""
    assert _CASES, "labeled_cases.json no contiene casos"
    for case in _CASES:
        assert case["expected_nivel"] in _VALID_NIVELES, (
            f"{case['name']}: expected_nivel '{case['expected_nivel']}' inválido"
        )
        assert case["bboxes"], f"{case['name']}: sin bboxes"


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_labeled_case_matches_expected_nivel(case):
    """La clasificación real de cada caso etiquetado coincide con el nivel esperado."""
    got = _resolve_nivel(case)
    assert got == case["expected_nivel"], (
        f"{case['name']} ({case['note']}): esperado {case['expected_nivel']}, got {got}"
    )
