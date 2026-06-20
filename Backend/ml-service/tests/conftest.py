"""
conftest.py — Fixtures compartidas para tests del ml-service.
"""

import base64
import io
import sys
from pathlib import Path

import pytest

# Raíz del ml-service en el path para importar módulos sin instalación
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _pil_to_b64(img) -> str:
    """Convierte PIL.Image a base64 JPEG."""
    from PIL import Image
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture()
def blank_img_b64() -> str:
    """Imagen 320×240 completamente negra → sin bordes → coverage ≈ 0."""
    from PIL import Image
    img = Image.new("RGB", (320, 240), color=(0, 0, 0))
    return _pil_to_b64(img)


@pytest.fixture()
def edge_heavy_img_b64() -> str:
    """Imagen 320×240 con patrón de tablero de ajedrez (8×8 px) → bordes densos → coverage alto."""
    from PIL import Image
    import numpy as np
    arr = np.zeros((240, 320, 3), dtype=np.uint8)
    for y in range(240):
        for x in range(320):
            if (x // 8 + y // 8) % 2 == 0:
                arr[y, x] = [255, 255, 255]
    img = Image.fromarray(arr)
    return _pil_to_b64(img)


@pytest.fixture()
def center_object_b64() -> str:
    """Imagen 320×240 con rectángulo blanco centrado ~40 % del área → coverage medio."""
    from PIL import Image
    import numpy as np
    arr = np.zeros((240, 320, 3), dtype=np.uint8)
    # Rectángulo centrado de ~40 % del área: 180×107 ≈ 19 260 px de 76 800 total
    cy, cx = 120, 160
    h, w = 107, 180
    arr[cy - h // 2: cy + h // 2, cx - w // 2: cx + w // 2] = [200, 200, 200]
    img = Image.fromarray(arr)
    return _pil_to_b64(img)
