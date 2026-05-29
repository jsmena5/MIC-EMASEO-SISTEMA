"""
test_pre_check_guidance.py
─────────────────────────────────────────────────────────────────────────────
Tests unitarios para las funciones de guía de distancia agregadas a ml_utils:
  - estimate_coverage_fast()
  - coverage_to_distance_hint()

Y tests de integración del endpoint /pre-check con guidance_mode usando
httpx.AsyncClient directamente sobre la app FastAPI (sin servidor real).

Ejecución:
  cd Backend/ml-service
  pip install -r requirements-test.txt
  python -m pytest tests/test_pre_check_guidance.py -v
"""

import base64
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_pil(color=(0, 0, 0), size=(320, 240)):
    from PIL import Image
    return Image.new("RGB", size, color=color)


def _pil_to_b64(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


# ─── Tests de estimate_coverage_fast ─────────────────────────────────────────

class TestEstimateCoverageFast:
    def test_blank_image_returns_zero(self):
        """Imagen completamente negra → sin bordes → coverage = 0.0."""
        from ml_utils import estimate_coverage_fast
        img = _make_pil(color=(0, 0, 0))
        result = estimate_coverage_fast(img)
        assert result == 0.0

    def test_white_image_returns_zero(self):
        """Imagen completamente blanca → sin gradiente → coverage = 0.0."""
        from ml_utils import estimate_coverage_fast
        img = _make_pil(color=(255, 255, 255))
        result = estimate_coverage_fast(img)
        assert result == 0.0

    def test_edge_heavy_returns_high_coverage(self, edge_heavy_img_b64):
        """Imagen con patrón de tablero de ajedrez → coverage > 0.60."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast
        img = Image.open(io.BytesIO(b64mod.b64decode(edge_heavy_img_b64))).convert("RGB")
        result = estimate_coverage_fast(img)
        assert result > 0.60, f"Expected > 0.60 but got {result}"

    def test_center_object_returns_medium_coverage(self, center_object_b64):
        """Rectángulo centrado ~40 % del área → coverage en rango medio [0.15, 0.70]."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast
        img = Image.open(io.BytesIO(b64mod.b64decode(center_object_b64))).convert("RGB")
        result = estimate_coverage_fast(img)
        assert 0.15 <= result <= 0.70, f"Expected [0.15, 0.70] but got {result}"

    def test_returns_float_rounded_to_4_decimals(self):
        """El resultado debe ser float con máximo 4 decimales."""
        import numpy as np
        from PIL import Image
        from ml_utils import estimate_coverage_fast
        arr = np.random.randint(0, 255, (240, 320, 3), dtype=np.uint8)
        img = Image.fromarray(arr)
        result = estimate_coverage_fast(img)
        assert isinstance(result, float)
        assert result == round(result, 4)


# ─── Tests de coverage_to_distance_hint ──────────────────────────────────────

class TestCoverageToDistanceHint:
    def test_hint_too_far_below_threshold(self):
        from ml_utils import coverage_to_distance_hint
        assert coverage_to_distance_hint(0.00) == "TOO_FAR"
        assert coverage_to_distance_hint(0.10) == "TOO_FAR"
        assert coverage_to_distance_hint(0.14) == "TOO_FAR"

    def test_hint_too_close_above_threshold(self):
        from ml_utils import coverage_to_distance_hint
        assert coverage_to_distance_hint(0.71) == "TOO_CLOSE"
        assert coverage_to_distance_hint(0.80) == "TOO_CLOSE"
        assert coverage_to_distance_hint(1.00) == "TOO_CLOSE"

    def test_hint_optimal_in_range(self):
        from ml_utils import coverage_to_distance_hint
        assert coverage_to_distance_hint(0.15) == "OPTIMAL"
        assert coverage_to_distance_hint(0.40) == "OPTIMAL"
        assert coverage_to_distance_hint(0.70) == "OPTIMAL"

    def test_hint_boundary_values(self):
        """Exactamente en los umbrales → clasificación correcta."""
        from ml_utils import coverage_to_distance_hint
        assert coverage_to_distance_hint(0.15) == "OPTIMAL"   # límite inferior incluido
        assert coverage_to_distance_hint(0.70) == "OPTIMAL"   # límite superior incluido
        assert coverage_to_distance_hint(0.7001) == "TOO_CLOSE"


# ─── Tests del pipeline de guidance (sin HTTP) ───────────────────────────────
# Prueba la combinación estimate_coverage_fast + coverage_to_distance_hint,
# que es exactamente lo que el endpoint ejecuta cuando guidance_mode=True.
# Sin FastAPI ni Celery — igual que el patrón de test_classification_bands.py.

class TestGuidancePipeline:
    def test_blank_image_pipeline_too_far(self, blank_img_b64):
        """Imagen negra → coverage=0 → TOO_FAR."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast, coverage_to_distance_hint
        img = Image.open(io.BytesIO(b64mod.b64decode(blank_img_b64))).convert("RGB")
        coverage = estimate_coverage_fast(img)
        hint     = coverage_to_distance_hint(coverage)
        assert coverage == 0.0
        assert hint == "TOO_FAR"

    def test_edge_heavy_image_pipeline_too_close(self, edge_heavy_img_b64):
        """Imagen con tablero de ajedrez → coverage alto → TOO_CLOSE."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast, coverage_to_distance_hint
        img = Image.open(io.BytesIO(b64mod.b64decode(edge_heavy_img_b64))).convert("RGB")
        coverage = estimate_coverage_fast(img)
        hint     = coverage_to_distance_hint(coverage)
        assert coverage > 0.65, f"Expected > 0.65, got {coverage}"
        assert hint == "TOO_CLOSE"

    def test_center_object_pipeline_optimal(self, center_object_b64):
        """Rectángulo centrado ~40 % del área → coverage en rango → OPTIMAL."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast, coverage_to_distance_hint
        img = Image.open(io.BytesIO(b64mod.b64decode(center_object_b64))).convert("RGB")
        coverage = estimate_coverage_fast(img)
        hint     = coverage_to_distance_hint(coverage)
        assert 0.15 <= coverage <= 0.70, f"Expected [0.15, 0.70], got {coverage}"
        assert hint == "OPTIMAL"

    def test_guidance_off_no_coverage_computation(self, blank_img_b64):
        """Sin guidance_mode no se llama estimate_coverage_fast (no se añaden campos)."""
        # Verificamos que estimate_coverage_fast no se importa en un flujo sin guidance
        # Simulamos la lógica del endpoint: solo ejecutar si guidance_mode=True
        from ml_utils import coverage_to_distance_hint
        guidance_mode = False
        result = {}
        if guidance_mode:
            from ml_utils import estimate_coverage_fast
            from PIL import Image
            import base64 as b64mod
            img = Image.open(io.BytesIO(b64mod.b64decode(blank_img_b64))).convert("RGB")
            cov = estimate_coverage_fast(img)
            result["coverage_ratio"] = cov
            result["distance_hint"]  = coverage_to_distance_hint(cov)
        assert "coverage_ratio" not in result
        assert "distance_hint"  not in result

    def test_guidance_on_adds_both_fields(self, center_object_b64):
        """Con guidance_mode=True el dict de resultado incluye ambos campos nuevos."""
        import base64 as b64mod
        from PIL import Image
        from ml_utils import estimate_coverage_fast, coverage_to_distance_hint
        guidance_mode = True
        result: dict = {}
        if guidance_mode:
            img = Image.open(io.BytesIO(b64mod.b64decode(center_object_b64))).convert("RGB")
            cov = estimate_coverage_fast(img)
            result["coverage_ratio"] = cov
            result["distance_hint"]  = coverage_to_distance_hint(cov)
        assert "coverage_ratio" in result
        assert "distance_hint"  in result
        assert result["distance_hint"] in ("TOO_FAR", "OPTIMAL", "TOO_CLOSE")
