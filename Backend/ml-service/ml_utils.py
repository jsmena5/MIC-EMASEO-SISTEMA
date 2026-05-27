"""
ml_utils.py
─────────────────────────────────────────────────────────────────────────────
Funciones puras de geometría, clasificación y análisis de imagen del pipeline
de inferencia.

Separadas de tasks.py para poder importarse sin depender de Celery/ultralytics,
lo que permite testearlas con pytest en cualquier entorno ligero.

Constantes de ajuste (NMS_CONF, DET_FACTOR_K, etc.) viven en tasks.py;
las que se usan aquí se reciben como argumentos para mantener este módulo
sin estado global, salvo el cache de modelos pesados (MiDaS).
"""

import logging
import math

logger = logging.getLogger(__name__)

# ── Constantes para garbage scoring ──────────────────────────────────────────
EDGE_GRAD_THRESHOLD  = 20   # magnitud de gradiente mínima para contar como borde
COLOR_QUANTIZE_STEP  = 8    # paso de cuantización: 256 // 8 = 32 niveles por canal

# ── Constantes para estimación de volumen MiDaS ───────────────────────────────
FOV_H_DEG         = 67.0   # FoV horizontal típico de smartphone (grados)
FOV_V_DEG         = 51.0   # FoV vertical típico de smartphone (grados)
GROUND_DEPTH_M    = 3.5    # distancia asumida al suelo visible en el frame (m)
GROUND_STRIP_FRAC = 0.15   # fracción inferior del frame usada como plano de suelo
GROUND_CENTER_FRAC = 0.40  # fracción central del ancho usada para muestrear el suelo
DEPTH_PILE_RATIO  = 0.28   # altura de pila estimada = 28 % del lado menor de la bbox
MAX_VOLUME_M3     = 20.0   # límite global de volumen (acumulación masiva en vía pública)

# ── Cache global del modelo MiDaS (lazy-load, seguro bajo el GIL de CPython) ──
_midas_model     = None
_midas_transform = None
_midas_device    = None


# ─────────────────────────────────────────────────────────────────────────────
# Funciones de geometría (sin estado)
# ─────────────────────────────────────────────────────────────────────────────

def coverage_union(detecciones: list, img_w: int, img_h: int) -> float:
    """Coverage ratio como UNIÓN de bboxes, no como suma.

    Rasteriza una máscara binaria (img_h × img_w): cada píxel se marca como
    True si pertenece a ≥1 bbox. Elimina la inflación por solapamiento que
    ocurría cuando múltiples cajas cubrían el mismo objeto (p.ej. 5 bboxes
    sobre un vaso → antes sumaban 5× el área real, ahora cuentan como 1×).

    Args:
        detecciones: lista de dicts con clave "bbox": [x1, y1, x2, y2]
        img_w, img_h: dimensiones del frame en píxeles

    Returns:
        ratio en [0.0, 1.0] redondeado a 4 decimales.
    """
    try:
        import numpy as np
    except ImportError:
        # Fallback sin numpy: suma clásica con techo 1.0 (comportamiento anterior)
        total = sum(
            (d["bbox"][2] - d["bbox"][0]) * (d["bbox"][3] - d["bbox"][1])
            for d in detecciones
        )
        return round(min(total / (img_w * img_h), 1.0), 4) if img_w * img_h > 0 else 0.0

    if not detecciones or img_w <= 0 or img_h <= 0:
        return 0.0
    import numpy as np
    mask = np.zeros((img_h, img_w), dtype=bool)
    for d in detecciones:
        x1, y1, x2, y2 = d["bbox"]
        x1, x2 = max(0, x1), min(img_w, x2)
        y1, y2 = max(0, y1), min(img_h, y2)
        if x2 > x1 and y2 > y1:
            mask[y1:y2, x1:x2] = True
    return round(float(mask.sum()) / (img_w * img_h), 4)


def is_clustered(detecciones: list, img_w: int, img_h: int,
                 threshold: float = 0.30) -> bool:
    """True si todos los centroides caen en un radio compacto (close-up).

    Calcula la diagonal del rectángulo envolvente de los centroides normalizados
    al tamaño del frame. Si esa diagonal < threshold el patrón sugiere múltiples
    bboxes sobre un mismo objeto (taza, botella, bolsa suelta) y no un acúmulo
    disperso en vía pública.

    Args:
        detecciones: lista de dicts con clave "bbox": [x1, y1, x2, y2]
        img_w, img_h: dimensiones del frame
        threshold: diagonal máxima normalizada para considerar cluster (default 0.30)

    Returns:
        True si los centroides están concentrados, False si están dispersos.
    """
    if len(detecciones) < 2:
        return False
    if img_w <= 0 or img_h <= 0:
        return False
    cx = [(d["bbox"][0] + d["bbox"][2]) / 2 / img_w for d in detecciones]
    cy = [(d["bbox"][1] + d["bbox"][3]) / 2 / img_h for d in detecciones]
    spread = math.sqrt((max(cx) - min(cx)) ** 2 + (max(cy) - min(cy)) ** 2)
    return spread < threshold


# ─────────────────────────────────────────────────────────────────────────────
# Garbage scoring: textura + entropía de color + posición vertical
# ─────────────────────────────────────────────────────────────────────────────

def compute_garbage_score(
    image,            # PIL.Image.Image (ya en RAM, antes de eliminar el archivo)
    detecciones: list,
    img_w: int,
    img_h: int,
) -> float:
    """Probabilidad 0–1 de que las detecciones sean basura real vs. objeto personal.

    Combina tres señales sobre cada región detectada:

    1. **Entropía de color** (peso 0.45):
       Basura real → muchos colores mezclados, alta entropía.
       Objeto uniforme (funda, bolso) → paleta reducida, baja entropía.
       Se cuantiza en 32 niveles/canal → 32³ códigos posibles.
       Entropía normalizada a 8 bits (≈ máxima práctica).

    2. **Densidad de bordes** (peso 0.40):
       Basura → texturas irregulares, muchos bordes afilados.
       Objeto liso → pocos bordes, gradientes suaves.
       Gradiente L1 simple (numpy.diff); fracción de píxeles > EDGE_GRAD_THRESHOLD,
       escalada a 1.0 cuando esa fracción alcanza 33 %.

    3. **Posición vertical** (peso 0.15):
       Basura en vía pública → parte inferior del encuadre (suelo).
       Objeto en mano → puede estar centrado o arriba.
       score = centro_y / img_h (0 = arriba, 1 = abajo).

    Returns:
        Score en [0.0, 1.0] (media de las detecciones). 0.0 en caso de error.
    """
    try:
        import numpy as np

        if not detecciones or img_w <= 0 or img_h <= 0:
            return 0.0

        img_arr = np.array(image.convert("RGB"), dtype=np.uint8)
        scores: list[float] = []

        for det in detecciones:
            x1, y1, x2, y2 = det["bbox"]
            x1, x2 = max(0, int(x1)), min(img_w, int(x2))
            y1, y2 = max(0, int(y1)), min(img_h, int(y2))
            if x2 <= x1 + 4 or y2 <= y1 + 4:
                continue

            crop = img_arr[y1:y2, x1:x2]  # (H, W, 3) uint8

            # ── 1. Entropía de color ─────────────────────────────────────────
            # Cuantiza a 32 niveles por canal, crea código entero único por píxel
            q = (crop // COLOR_QUANTIZE_STEP).astype(np.int32)
            codes = q[:, :, 0] * 1024 + q[:, :, 1] * 32 + q[:, :, 2]
            total_px = codes.size
            _, counts = np.unique(codes.ravel(), return_counts=True)
            probs = counts / total_px
            entropy = -float(np.sum(probs * np.log2(probs + 1e-12)))
            color_score = min(1.0, entropy / 8.0)

            # ── 2. Densidad de bordes ────────────────────────────────────────
            # Gradiente L1 en escala de grises (evita sqrt → más rápido)
            gray = np.mean(crop, axis=2).astype(np.float32)
            gx = np.abs(np.diff(gray, axis=1))           # (H, W-1)
            gy = np.abs(np.diff(gray, axis=0))           # (H-1, W)
            min_h = min(gx.shape[0], gy.shape[0])
            min_w = min(gx.shape[1], gy.shape[1])
            mag = gx[:min_h, :min_w] + gy[:min_h, :min_w]  # aprox. grad magnitude
            edge_fraction = float(np.mean(mag > EDGE_GRAD_THRESHOLD))
            edge_score = min(1.0, edge_fraction * 3.0)   # 0.33 fracción → 1.0

            # ── 3. Posición vertical ─────────────────────────────────────────
            center_y = (y1 + y2) / 2.0
            pos_score = center_y / img_h                 # 0=arriba, 1=abajo

            det_score = 0.45 * color_score + 0.40 * edge_score + 0.15 * pos_score
            scores.append(det_score)

        if not scores:
            return 0.0

        return round(float(sum(scores) / len(scores)), 4)

    except Exception as exc:
        logger.warning("[compute_garbage_score] error → score=0.0: %s", exc)
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# Estimación de volumen con profundidad monocular (MiDaS)
# ─────────────────────────────────────────────────────────────────────────────

def _load_midas():
    """Carga MiDaS_small lazy y lo cachea en módulo (no reinicializa entre tareas).

    Usa la variable de entorno TORCH_HOME para el directorio de caché, que en
    producción se pre-descarga en build-time (ver Dockerfile).
    Retorna (model, transform, device) o lanza excepción si falla la carga.
    """
    global _midas_model, _midas_transform, _midas_device

    if _midas_model is not None:
        return _midas_model, _midas_transform, _midas_device

    import torch

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    logger.info("[MiDaS] Cargando MiDaS_small en %s …", device)
    midas = torch.hub.load(
        "intel-isl/MiDaS", "MiDaS_small",
        trust_repo=True, verbose=False,
    )
    midas.to(device).eval()

    transforms = torch.hub.load(
        "intel-isl/MiDaS", "transforms",
        trust_repo=True, verbose=False,
    )
    transform = transforms.small_transform

    _midas_model     = midas
    _midas_transform = transform
    _midas_device    = device

    logger.info("[MiDaS] Modelo listo en %s", device)
    return midas, transform, device


def estimate_volume_midas(
    image,            # PIL.Image.Image (ya en RAM)
    detecciones: list,
    img_w: int,
    img_h: int,
) -> float | None:
    """Estima el volumen total de acumulación usando profundidad monocular MiDaS.

    Calibración:
    - La franja inferior del encuadre (GROUND_STRIP_FRAC, centro GROUND_CENTER_FRAC)
      se asume a GROUND_DEPTH_M metros (plano de suelo).
    - La disparidad MiDaS es proporcional a la profundidad inversa:
      dist_objeto = GROUND_DEPTH_M × (disp_suelo / disp_objeto).
    - Dimensiones reales calculadas con FoV horizontal/vertical del smartphone.
    - Profundidad de pila: DEPTH_PILE_RATIO × min(ancho_real, alto_real).

    Returns:
        Volumen total en m³ (suma de todas las detecciones), redondeado a 3 decimales.
        None si la inferencia falla o no hay detecciones válidas (caller usa fallback).
    """
    try:
        import numpy as np
        import torch

        if not detecciones or img_w <= 0 or img_h <= 0:
            return None

        midas, transform, device = _load_midas()

        img_np      = np.array(image.convert("RGB"))
        input_batch = transform(img_np).to(device)

        with torch.no_grad():
            depth_pred = midas(input_batch)
            # Interpola el mapa de profundidad al tamaño original de la imagen
            depth_pred = torch.nn.functional.interpolate(
                depth_pred.unsqueeze(1),
                size=(img_h, img_w),
                mode="bicubic",
                align_corners=False,
            ).squeeze()

        # depth_map[y, x]: mayor valor = más cerca de la cámara (disparidad)
        depth_map: "np.ndarray" = depth_pred.cpu().numpy().astype(np.float32)

        # ── Calibrar al plano de suelo ────────────────────────────────────────
        g_y0 = int(img_h * (1.0 - GROUND_STRIP_FRAC))
        g_x0 = int(img_w * (0.5 - GROUND_CENTER_FRAC / 2))
        g_x1 = int(img_w * (0.5 + GROUND_CENTER_FRAC / 2))
        ground_region = depth_map[g_y0:, g_x0:g_x1]

        if ground_region.size == 0:
            logger.warning("[MiDaS] Región de suelo vacía — no se puede calibrar")
            return None

        ground_disp = float(np.median(ground_region))
        if ground_disp < 1e-6:
            logger.warning("[MiDaS] Disparidad de suelo casi cero — imagen inválida")
            return None

        tan_h = math.tan(math.radians(FOV_H_DEG / 2))
        tan_v = math.tan(math.radians(FOV_V_DEG / 2))

        total_volume = 0.0
        for det in detecciones:
            x1, y1, x2, y2 = det["bbox"]
            x1 = max(0, min(img_w - 1, int(x1)))
            x2 = max(0, min(img_w - 1, int(x2)))
            y1 = max(0, min(img_h - 1, int(y1)))
            y2 = max(0, min(img_h - 1, int(y2)))
            if x2 <= x1 or y2 <= y1:
                continue

            # Muestrea la profundidad en el cuarto inferior de la bbox
            # (base del objeto → más cercano al suelo → más representativo)
            roi_y0 = max(0, y2 - max(1, (y2 - y1) // 4))
            cx     = (x1 + x2) // 2
            hw     = max(1, (x2 - x1) // 4)
            roi_x0 = max(0, cx - hw)
            roi_x1 = min(img_w, cx + hw)
            obj_region = depth_map[roi_y0:y2 + 1, roi_x0:roi_x1]

            if obj_region.size == 0:
                continue

            obj_disp = float(np.median(obj_region))
            if obj_disp < 1e-6:
                continue

            # Distancia real al objeto (inversa de la disparidad relativa)
            obj_dist_m = GROUND_DEPTH_M * (ground_disp / obj_disp)
            obj_dist_m = max(0.3, min(50.0, obj_dist_m))   # sanity clamp

            # Dimensiones reales de la bbox proyectadas a esa distancia
            real_w = ((x2 - x1) / img_w) * 2.0 * obj_dist_m * tan_h
            real_h = ((y2 - y1) / img_h) * 2.0 * obj_dist_m * tan_v

            # Altura de pila estimada: DEPTH_PILE_RATIO × lado menor
            pile_depth = min(real_w, real_h) * DEPTH_PILE_RATIO
            volume     = real_w * real_h * pile_depth
            total_volume += volume

        if total_volume <= 0:
            return None

        return round(min(MAX_VOLUME_M3, total_volume), 3)

    except Exception as exc:
        logger.warning("[estimate_volume_midas] error → fallback None: %s", exc)
        return None
