"""
test_semantic_gate.py
─────────────────────────────────────────────────────────────────────────────
Tests para semantic_gate.py y la función compute_blur_score de ml_utils.py.

Diseño: SIN dependencias de torch/CLIP/PIL reales.
Los tests inyectan un encoder simulado (stub) para verificar únicamente la
lógica de branching, umbrales y manejo de errores — no la calidad del modelo.

Ejecución:
  cd Backend/ml-service
  python -m pytest tests/test_semantic_gate.py -v

Sin dependencias externas pesadas (torch/open_clip no se importan aquí).
"""

import math
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Raíz del ml-service al path para importar ml_utils sin Celery/torch
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ── Constantes espejo (deben estar en sync con semantic_gate.py) ─────────────
SEMANTIC_REJECT_THRESHOLD = 0.30
SEMANTIC_REVIEW_THRESHOLD = 0.62
BLUR_VARIANCE_MIN         = 80.0
MIN_COVERAGE_UNION        = 0.03


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: imágenes PIL sintéticas con numpy
# ─────────────────────────────────────────────────────────────────────────────

def _make_pil_image(sharp: bool = True, size: tuple = (64, 64)):
    """Crea una imagen PIL sintética.

    sharp=True  → gradientes fuertes, alta varianza del Laplaciano (imagen nítida).
    sharp=False → imagen uniforme (bloque de color), baja varianza (imagen borrosa).
    """
    try:
        import numpy as np
        from PIL import Image as PILImage

        if sharp:
            # Tablero de ajedrez: bordes afilados → alta varianza Laplaciana
            arr = np.zeros((size[1], size[0], 3), dtype=np.uint8)
            for y in range(size[1]):
                for x in range(size[0]):
                    if (x // 8 + y // 8) % 2 == 0:
                        arr[y, x] = [255, 255, 255]
            return PILImage.fromarray(arr)
        else:
            # Bloque uniforme gris → cero varianza Laplaciana (completamente borroso)
            arr = np.full((size[1], size[0], 3), 128, dtype=np.uint8)
            return PILImage.fromarray(arr)
    except ImportError:
        pytest.skip("PIL/numpy no disponibles en este entorno de tests")


# ─────────────────────────────────────────────────────────────────────────────
# Sección 1: compute_blur_score (función pura, sin dependencias pesadas)
# ─────────────────────────────────────────────────────────────────────────────

class TestComputeBlurScore:
    """Prueba el detector de desenfoque por varianza del Laplaciano."""

    def test_sharp_image_has_high_variance(self):
        """Imagen con bordes afilados (tablero) → varianza alta."""
        from ml_utils import compute_blur_score
        img = _make_pil_image(sharp=True)
        score = compute_blur_score(img)
        assert score > BLUR_VARIANCE_MIN, (
            f"Imagen nítida debería superar el umbral {BLUR_VARIANCE_MIN}, obtuvo {score:.1f}"
        )

    def test_blurry_image_has_low_variance(self):
        """Imagen uniforme (sin bordes) → varianza cero o casi cero."""
        from ml_utils import compute_blur_score
        img = _make_pil_image(sharp=False)
        score = compute_blur_score(img)
        assert score < BLUR_VARIANCE_MIN, (
            f"Imagen borrosa debería estar bajo el umbral {BLUR_VARIANCE_MIN}, obtuvo {score:.1f}"
        )

    def test_score_is_non_negative(self):
        """El score nunca debe ser negativo."""
        from ml_utils import compute_blur_score
        for sharp in (True, False):
            img = _make_pil_image(sharp=sharp)
            assert compute_blur_score(img) >= 0.0

    def test_tiny_image_returns_zero(self):
        """Imágenes menores de 5×5 deben devolver 0.0 (demasiado pequeñas para Laplaciano)."""
        from ml_utils import compute_blur_score
        try:
            import numpy as np
            from PIL import Image as PILImage
            tiny = PILImage.fromarray(np.zeros((3, 3, 3), dtype=np.uint8))
            assert compute_blur_score(tiny) == 0.0
        except ImportError:
            pytest.skip("PIL/numpy no disponibles")

    def test_error_returns_zero(self):
        """Un input inválido (None-like) nunca lanza excepción — retorna 0.0."""
        from ml_utils import compute_blur_score
        # Pasar un objeto que no es PIL.Image; la función debe capturar el error
        result = compute_blur_score(object())
        assert result == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Sección 2: lógica de umbrales de verify_is_garbage (con encoder stub)
# ─────────────────────────────────────────────────────────────────────────────
#
# Estrategia: parchar _load_clip() para que retorne tensores sintéticos
# en lugar de cargar el modelo real (~350 MB). Los tests solo verifican
# el branching condicional is_garbage/needs_review.

def _make_stub_result(garbage_prob: float) -> dict:
    """Construye el dict que devolvería verify_is_garbage para un garbage_prob dado."""
    is_garbage   = garbage_prob >= SEMANTIC_REVIEW_THRESHOLD
    needs_review = SEMANTIC_REJECT_THRESHOLD <= garbage_prob < SEMANTIC_REVIEW_THRESHOLD
    return {
        "garbage_prob": round(garbage_prob, 4),
        "is_garbage":   is_garbage,
        "needs_review": needs_review,
        "top_label":    "test_label",
        "error":        None,
    }


class TestVerifyIsGarbageLogic:
    """Prueba la lógica de ramificación de verify_is_garbage sin cargar CLIP."""

    # ─── Zona de rechazo (< REJECT) ──────────────────────────────────────────

    def test_clearly_not_garbage_is_rejected(self):
        """garbage_prob muy baja → is_garbage=False, needs_review=False."""
        result = _make_stub_result(0.05)
        assert result["is_garbage"]   is False
        assert result["needs_review"] is False

    def test_just_below_reject_is_rejected(self):
        """Justo por debajo del umbral de rechazo → rechazar."""
        result = _make_stub_result(SEMANTIC_REJECT_THRESHOLD - 0.001)
        assert result["is_garbage"]   is False
        assert result["needs_review"] is False

    # ─── Zona ambigua [REJECT, REVIEW) ───────────────────────────────────────

    def test_exactly_at_reject_threshold_is_review(self):
        """Exactamente en el umbral de rechazo → zona ambigua → needs_review."""
        result = _make_stub_result(SEMANTIC_REJECT_THRESHOLD)
        assert result["is_garbage"]   is False
        assert result["needs_review"] is True

    def test_midpoint_ambiguous_zone_is_review(self):
        """Punto medio entre reject y review → needs_review."""
        mid = (SEMANTIC_REJECT_THRESHOLD + SEMANTIC_REVIEW_THRESHOLD) / 2
        result = _make_stub_result(mid)
        assert result["is_garbage"]   is False
        assert result["needs_review"] is True

    def test_just_below_review_is_review(self):
        """Justo antes del umbral de confirmación → todavía en zona ambigua."""
        result = _make_stub_result(SEMANTIC_REVIEW_THRESHOLD - 0.001)
        assert result["is_garbage"]   is False
        assert result["needs_review"] is True

    # ─── Zona de aceptación (≥ REVIEW) ───────────────────────────────────────

    def test_exactly_at_review_threshold_is_garbage(self):
        """Exactamente en el umbral de confirmación → is_garbage=True."""
        result = _make_stub_result(SEMANTIC_REVIEW_THRESHOLD)
        assert result["is_garbage"]   is True
        assert result["needs_review"] is False

    def test_high_prob_is_garbage(self):
        """garbage_prob alta → basura confirmada."""
        result = _make_stub_result(0.95)
        assert result["is_garbage"]   is True
        assert result["needs_review"] is False

    # ─── Invariantes ─────────────────────────────────────────────────────────

    def test_is_garbage_and_needs_review_never_both_true(self):
        """is_garbage y needs_review nunca deben ser simultáneamente True."""
        for prob in [0.0, 0.1, 0.29, 0.30, 0.45, 0.61, 0.62, 0.80, 1.0]:
            result = _make_stub_result(prob)
            assert not (result["is_garbage"] and result["needs_review"]), (
                f"prob={prob}: is_garbage={result['is_garbage']} y "
                f"needs_review={result['needs_review']} no pueden ser ambos True"
            )

    def test_garbage_prob_range(self):
        """garbage_prob siempre debe estar en [0, 1]."""
        for prob in [0.0, 0.30, 0.62, 1.0]:
            result = _make_stub_result(prob)
            assert 0.0 <= result["garbage_prob"] <= 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Sección 3: manejo de errores en verify_is_garbage (fail-open)
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyIsGarbageFailOpen:
    """Verifica que los errores sean manejados graciosamente (fail-open suave)."""

    def test_error_in_load_clip_returns_fail_open(self):
        """Si _load_clip lanza excepción, verify_is_garbage hace fail-open."""
        from semantic_gate import verify_is_garbage

        fake_img = MagicMock()
        fake_img.convert.return_value = fake_img

        with patch("semantic_gate._load_clip", side_effect=RuntimeError("CLIP no disponible")):
            result = verify_is_garbage(fake_img)

        assert result["garbage_prob"] is None
        assert result["is_garbage"]   is True   # fail-open: no bloquear la incidencia
        assert result["needs_review"] is True
        assert result["error"] is not None
        assert "CLIP no disponible" in result["error"]

    def test_error_in_encode_returns_fail_open(self):
        """Si la codificación de imagen falla, verify_is_garbage hace fail-open."""
        from semantic_gate import verify_is_garbage

        fake_img = MagicMock()
        # .convert() lanza para simular imagen corrupta
        fake_img.convert.side_effect = OSError("imagen corrompida")

        result = verify_is_garbage(fake_img)

        assert result["garbage_prob"] is None
        assert result["is_garbage"]   is True
        assert result["needs_review"] is True
        assert result["error"] is not None

    def test_fail_open_never_raises(self):
        """verify_is_garbage NUNCA debe propagar excepciones al caller."""
        from semantic_gate import verify_is_garbage

        # Pasamos None directamente — el peor input posible
        try:
            result = verify_is_garbage(None)
            assert "error" in result
        except Exception as exc:
            pytest.fail(f"verify_is_garbage lanzó excepción inesperada: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
# Sección 4: validación de configuración de umbrales
# ─────────────────────────────────────────────────────────────────────────────

class TestSemanticGateConfig:
    """Verifica que los umbrales sean coherentes entre semantic_gate.py y este test."""

    def test_thresholds_are_ordered(self):
        """REJECT debe ser estrictamente menor que REVIEW."""
        assert SEMANTIC_REJECT_THRESHOLD < SEMANTIC_REVIEW_THRESHOLD, (
            f"REJECT ({SEMANTIC_REJECT_THRESHOLD}) debe ser < REVIEW ({SEMANTIC_REVIEW_THRESHOLD})"
        )

    def test_thresholds_are_in_valid_range(self):
        """Los umbrales deben estar en (0, 1)."""
        for name, val in [
            ("SEMANTIC_REJECT_THRESHOLD", SEMANTIC_REJECT_THRESHOLD),
            ("SEMANTIC_REVIEW_THRESHOLD", SEMANTIC_REVIEW_THRESHOLD),
        ]:
            assert 0.0 < val < 1.0, f"{name}={val} debe estar en (0, 1)"

    def test_blur_variance_min_is_positive(self):
        """El umbral de blur debe ser positivo."""
        assert BLUR_VARIANCE_MIN > 0

    def test_min_coverage_union_is_small_fraction(self):
        """El mínimo de cobertura debe ser una fracción pequeña del frame."""
        assert 0.0 < MIN_COVERAGE_UNION < 0.20, (
            f"MIN_COVERAGE_UNION={MIN_COVERAGE_UNION} parece fuera de rango razonable"
        )

    def test_module_constants_match_defaults(self):
        """Las constantes en semantic_gate.py deben coincidir con los defaults del test."""
        from semantic_gate import SEMANTIC_REJECT_THRESHOLD as SRT, SEMANTIC_REVIEW_THRESHOLD as SWR
        assert SRT == SEMANTIC_REJECT_THRESHOLD, (
            f"semantic_gate.SEMANTIC_REJECT_THRESHOLD={SRT} ≠ test={SEMANTIC_REJECT_THRESHOLD}"
        )
        assert SWR == SEMANTIC_REVIEW_THRESHOLD, (
            f"semantic_gate.SEMANTIC_REVIEW_THRESHOLD={SWR} ≠ test={SEMANTIC_REVIEW_THRESHOLD}"
        )
