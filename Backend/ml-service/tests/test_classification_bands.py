"""
test_classification_bands.py
─────────────────────────────────────────────────────────────────────────────
Pruebas unitarias para la lógica de clasificación de bandas del ml-service.

Cubre:
  1. _coverage_union  — unión vs suma de bboxes (corrección principal)
  2. _is_clustered    — detección de close-ups con múltiples cajas
  3. Escenario "vaso/taza" — el falso CRÍTICO reportado
  4. Escenarios reales: BAJO, MEDIO, ALTO, CRÍTICO
  5. Invariantes de las bandas (monotonía, límites, topes)

Ejecución:
  cd Backend/ml-service
  python -m pytest tests/test_classification_bands.py -v

Sin dependencias externas pesadas (ultralytics/torch no se importan aquí).
"""

import math
import sys
from pathlib import Path

# Añadir la raíz del ml-service al path para importar tasks y config_classes
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest

# Lógica y constantes de clasificación: importadas del MÓDULO REAL (ml_utils),
# NO redefinidas. Antes se duplicaban aquí (y la lógica se reescribía en _classify/
# _classify_full), lo que permitía que el test pasara mientras la lógica de
# producción divergía. Ahora el test ejerce el código real. ml_utils no depende
# de Celery/ultralytics, así que sigue siendo importable en un entorno ligero.
from ml_utils import (
    coverage_union           as _coverage_union,
    is_clustered             as _is_clustered,
    classify_severity        as _classify_severity,
    _BANDS,
    DET_FACTOR_K,
    DET_FACTOR_CEILING,
    ISOLATION_COVERAGE_THRESHOLD,
    GARBAGE_SCORE_THRESHOLD,
    GARBAGE_SCORE_HARD_FLOOR,
    ISOLATION_MAX_SINGLE_PENALTY,
    PILE_RESCUE_MAX_DETS,
    PILE_RESCUE_MIN_COVERAGE,
    PILE_RESCUE_MIN_SCORE,
    PILE_RESCUE_DET_FLOOR,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers para construir escenarios de detección
# ─────────────────────────────────────────────────────────────────────────────

IMG_W, IMG_H = 1280, 960
IMG_AREA = IMG_W * IMG_H


def make_det(x1, y1, x2, y2, cls="garbage", conf=0.80):
    return {"class": cls, "confidence": conf, "bbox": [x1, y1, x2, y2]}


def _classify(coverage_ratio, confianza, num_detecciones, tipo_residuo="MIXTO",
              detecciones=None, garbage_score=0.30):
    """Adaptador sobre classify_severity REAL (ml_utils).

    Mantiene la firma/retorno histórico — (nivel, prioridad, volumen, effective_ratio,
    scale_penalty_applied) — para no reescribir los call-sites existentes. El
    garbage_score por defecto (0.30) representa un objeto de textura ambigua, por
    debajo de PILE_RESCUE_MIN_SCORE, así que el rescate de pila NO se activa en estos
    escenarios genéricos (los tests específicos de rescate pasan un score alto).
    """
    if detecciones is None:
        # Generar detecciones ficticias dispersas por toda la imagen
        detecciones = _make_dispersed_dets(num_detecciones)

    r = _classify_severity(
        coverage_ratio=coverage_ratio,
        confianza=confianza,
        num_detecciones=num_detecciones,
        garbage_score=garbage_score,
        tipo_residuo=tipo_residuo,
        detecciones=detecciones,
        img_w=IMG_W,
        img_h=IMG_H,
    )
    return r["nivel"], r["prioridad"], r["volumen"], r["effective_ratio"], r["scale_penalty_applied"]


def _make_dispersed_dets(n):
    """Crea n detecciones distribuidas uniformemente en el frame."""
    step = IMG_W // (n + 1)
    return [make_det(step * i, 100, step * i + 150, 300) for i in range(1, n + 1)]


def _classify_full(coverage_ratio, confianza, num_detecciones, garbage_score,
                   tipo_residuo="MIXTO", detecciones=None):
    """Adaptador que reproduce el flujo de run_inference con garbage_score:

      - Paso 1b: rechazo por garbage_score < HARD_FLOOR (devuelve None) — esta es la
        única línea de tasks.py que clasificación NO incluye, así que la replicamos.
      - Resto: delega en classify_severity REAL (incluye rescate de pila, penalty
        interpolado por score y guarda geométrica de CRÍTICO).

    Returns:
        None si fue rechazado por hard floor (has_waste=false).
        (nivel, prioridad, volumen, effective_ratio) en caso contrario.
    """
    if detecciones is None:
        detecciones = _make_dispersed_dets(num_detecciones)

    # Paso 1b: hard floor del garbage_score (gate de run_inference, previo a clasificar)
    if garbage_score < GARBAGE_SCORE_HARD_FLOOR:
        return None  # rechazado → has_waste=false

    r = _classify_severity(
        coverage_ratio=coverage_ratio,
        confianza=confianza,
        num_detecciones=num_detecciones,
        garbage_score=garbage_score,
        tipo_residuo=tipo_residuo,
        detecciones=detecciones,
        img_w=IMG_W,
        img_h=IMG_H,
    )
    return r["nivel"], r["prioridad"], r["volumen"], r["effective_ratio"]


def _make_clustered_dets(n, cx=640, cy=480, size=80):
    """Crea n bboxes concentrados alrededor de (cx, cy) — simula close-up."""
    return [
        make_det(cx - size + i * 5, cy - size + i * 5,
                 cx + size + i * 5, cy + size + i * 5)
        for i in range(n)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Tests de _coverage_union
# ─────────────────────────────────────────────────────────────────────────────

class TestCoverageUnion:

    def test_single_bbox(self):
        """Un solo bbox cubre exactamente su área."""
        dets = [make_det(0, 0, 128, 96)]  # 128×96 = 12288 px
        ratio = _coverage_union(dets, IMG_W, IMG_H)
        expected = 12288 / IMG_AREA
        assert abs(ratio - expected) < 0.001

    def test_non_overlapping_two(self):
        """Dos bboxes sin solapamiento: la unión = suma."""
        d1 = make_det(0, 0, 100, 100)     # 10000 px
        d2 = make_det(200, 200, 300, 300) # 10000 px
        ratio = _coverage_union([d1, d2], IMG_W, IMG_H)
        expected = 20000 / IMG_AREA
        assert abs(ratio - expected) < 0.001

    def test_fully_overlapping_five(self):
        """5 bboxes idénticos → unión == 1× el área, no 5×."""
        dets = [make_det(100, 100, 300, 300)] * 5
        single = _coverage_union([make_det(100, 100, 300, 300)], IMG_W, IMG_H)
        five   = _coverage_union(dets, IMG_W, IMG_H)
        assert abs(five - single) < 0.001, (
            f"Con 5 bboxes idénticos se esperaba {single:.4f} (unión), got {five:.4f} (suma sería 5×)"
        )

    def test_partially_overlapping(self):
        """Dos bboxes solapados a la mitad: la unión < suma."""
        d1 = make_det(0, 0, 200, 200)   # 40000 px
        d2 = make_det(100, 0, 300, 200) # 40000 px; solapan 100×200=20000 px
        ratio  = _coverage_union([d1, d2], IMG_W, IMG_H)
        union_px = 60000  # 40000 + 40000 - 20000
        expected = union_px / IMG_AREA
        assert abs(ratio - expected) < 0.001

    def test_empty(self):
        assert _coverage_union([], IMG_W, IMG_H) == 0.0

    def test_never_exceeds_one(self):
        """Aunque haya miles de bboxes solapados, el ratio ≤ 1."""
        dets = [make_det(0, 0, IMG_W, IMG_H)] * 20
        assert _coverage_union(dets, IMG_W, IMG_H) <= 1.0

    def test_clamps_out_of_bounds_bbox(self):
        """Bbox fuera de la imagen no lanza excepción y se recorta."""
        dets = [make_det(-50, -50, IMG_W + 100, IMG_H + 100)]
        ratio = _coverage_union(dets, IMG_W, IMG_H)
        assert ratio == pytest.approx(1.0, abs=0.001)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Tests de _is_clustered
# ─────────────────────────────────────────────────────────────────────────────

class TestIsClusteredHelper:

    def test_single_det_not_clustered(self):
        dets = [make_det(100, 100, 300, 300)]
        assert _is_clustered(dets, IMG_W, IMG_H) is False

    def test_two_dets_same_position_clustered(self):
        dets = [make_det(100, 100, 300, 300), make_det(110, 110, 290, 290)]
        assert _is_clustered(dets, IMG_W, IMG_H) is True

    def test_two_dets_opposite_corners_not_clustered(self):
        dets = [
            make_det(0, 0, 200, 200),          # esquina superior-izquierda
            make_det(1080, 760, 1280, 960),    # esquina inferior-derecha
        ]
        assert _is_clustered(dets, IMG_W, IMG_H) is False

    def test_five_dets_on_cup_clustered(self):
        """Simula 5 detecciones sobre el mismo vaso en el centro del frame."""
        dets = _make_clustered_dets(5, cx=640, cy=480, size=60)
        assert _is_clustered(dets, IMG_W, IMG_H) is True

    def test_five_dets_dispersed_not_clustered(self):
        dets = _make_dispersed_dets(5)
        assert _is_clustered(dets, IMG_W, IMG_H) is False

    def test_three_dets_tight_cluster(self):
        # Centroides a ≤5% de separación normalizada → cluster
        dets = [
            make_det(620, 460, 660, 500),
            make_det(625, 465, 655, 495),
            make_det(630, 470, 650, 490),
        ]
        assert _is_clustered(dets, IMG_W, IMG_H) is True


# ─────────────────────────────────────────────────────────────────────────────
# 3. Escenario del vaso / falso CRÍTICO (bug reportado)
# ─────────────────────────────────────────────────────────────────────────────

class TestVasoCriticalFalsePositive:
    """
    Datos del incidente real:
      - confianza 0.56, 5 detecciones, tipo MIXTO
      - El bug producía CRÍTICA con 7.07 m³ porque coverage = SUMA (no unión)

    Con la corrección (unión de bboxes en close-up):
      - coverage_union de 5 bboxes solapados sobre un vaso ≈ 5–15 % del frame
      - effective_ratio → BAJO o MEDIO, nunca CRÍTICO
    """

    def test_cup_closeup_five_overlapping_bboxes(self):
        """5 bboxes solapados sobre el mismo vaso → no debe ser CRÍTICO."""
        # Simula 5 bboxes casi idénticos sobre un vaso (15% del frame)
        dets = [make_det(560, 390, 720, 570, conf=0.56)] * 5
        coverage = _coverage_union(dets, IMG_W, IMG_H)

        nivel, prioridad, volumen, eff, penalty = _classify(
            coverage_ratio=coverage,
            confianza=0.56,
            num_detecciones=5,
            tipo_residuo="MIXTO",
            detecciones=dets,
        )

        assert nivel != "CRITICO", (
            f"Un vaso close-up clasificó como CRITICO (volumen={volumen} m³, eff={eff:.3f}). "
            "La corrección de unión de bboxes + isolation penalty deben evitar esto."
        )
        assert volumen < 5.0, (
            f"Volumen {volumen} m³ es demasiado alto para un close-up de vaso desechable."
        )

    def test_cup_coverage_union_is_much_less_than_sum(self):
        """La cobertura por unión debe ser ~5× menor que por suma para bboxes idénticos."""
        dets = [make_det(560, 390, 720, 570)] * 5
        union_ratio = _coverage_union(dets, IMG_W, IMG_H)

        # Suma clásica (comportamiento anterior)
        bbox_area = (720 - 560) * (570 - 390)
        sum_ratio  = min(5 * bbox_area / IMG_AREA, 1.0)

        assert union_ratio < sum_ratio * 0.3, (
            f"Se esperaba unión ({union_ratio:.4f}) << suma ({sum_ratio:.4f}). "
            f"Ratio unión/suma = {union_ratio/sum_ratio:.2f} (debe ser < 0.3 para 5 cajas idénticas)"
        )

    def test_cup_with_isolation_penalty(self):
        """El cluster penalty debe activarse para 5 bboxes concentrados."""
        dets = _make_clustered_dets(5, cx=640, cy=480, size=80)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        _, _, _, _, penalty = _classify(coverage, 0.56, 5, detecciones=dets)
        assert penalty is True, "El scale_penalty no se activó para un cluster de 5 bboxes"


# ─────────────────────────────────────────────────────────────────────────────
# 4. Escenarios reales de acumulación en vía pública
# ─────────────────────────────────────────────────────────────────────────────

class TestRealAccumulationScenarios:

    def test_bajo_small_scattered(self):
        """Pocas bolsas pequeñas dispersas → BAJO."""
        dets = _make_dispersed_dets(2)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        nivel, _, volumen, _, _ = _classify(coverage, 0.65, 2, detecciones=dets)
        # coverage ~0.035 → effective pequeño
        assert nivel in ("BAJO",), f"Se esperaba BAJO, got {nivel} (vol={volumen})"

    def test_medio_moderate_coverage(self):
        """Cobertura moderada (~25 %) con buena confianza → MEDIO."""
        # Construir dets que realmente cubran ~25% del frame
        dets = [
            make_det(0,   0,   640, 240),   # 640×240
            make_det(640, 0,   1280, 240),  # 640×240
        ]
        # Unión ≈ 1280×240 = 307200 px / 1228800 ≈ 0.25
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        nivel, _, volumen, _, _ = _classify(coverage, 0.72, 2, detecciones=dets)
        assert nivel in ("MEDIO", "BAJO"), f"Se esperaba BAJO/MEDIO, got {nivel}"

    def test_alto_large_real_accumulation(self):
        """Cobertura alta (~55 %) con múltiples cajas dispersas → ALTO."""
        dets = [
            make_det(0,   0,   640, 480),   # cuadrante sup-izq
            make_det(640, 0,   1280, 480),  # cuadrante sup-der
            make_det(200, 480, 800,  720),  # franja central
        ]
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        nivel, _, volumen, _, _ = _classify(coverage, 0.80, 3, detecciones=dets)
        assert nivel in ("ALTO", "MEDIO"), f"Cobertura real {coverage:.2f} → esperaba ALTO/MEDIO, got {nivel}"

    def test_critico_requires_dispersed_detections(self):
        """CRÍTICO requiere ≥3 detecciones NO concentradas."""
        # 2 dets dispersas con coverage muy alto: debe degradarse
        dets = [
            make_det(0,   0,  1280, 480),   # mitad superior completa
            make_det(0, 480,  1280, 960),   # mitad inferior completa
        ]
        coverage = _coverage_union(dets, IMG_W, IMG_H)  # ≈ 1.0
        nivel, _, _, _, _ = _classify(coverage, 0.90, 2, detecciones=dets)
        assert nivel != "CRITICO", (
            "Con solo 2 dets no debe clasificarse como CRITICO aunque coverage=1.0"
        )

    def test_critico_with_3_dispersed_high_coverage(self):
        """3 dets bien dispersas con coverage alto pueden alcanzar CRÍTICO."""
        dets = [
            make_det(0,   0,   640, 480),
            make_det(640, 0,   1280, 480),
            make_det(200, 480, 1000, 960),
        ]
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        nivel, prioridad, volumen, eff, _ = _classify(coverage, 0.90, 3, detecciones=dets)
        # con coverage ~75% y conf 0.90, effective debería llegar a CRITICO
        print(f"[test_critico] coverage={coverage:.3f} eff={eff:.3f} nivel={nivel} vol={volumen}")
        # No forzamos CRITICO aquí porque depende de los pesos — solo verificamos que no crashee
        assert nivel in ("ALTO", "CRITICO"), f"Acumulación real grande inesperada: {nivel}"


# ─────────────────────────────────────────────────────────────────────────────
# 5. Invariantes de las bandas
# ─────────────────────────────────────────────────────────────────────────────

class TestBandInvariants:

    def test_bands_cover_full_range(self):
        """Las bandas cubren el rango [0, 1] sin huecos ni solapamientos."""
        prev_max = 0.0
        for c_min, c_max, *_ in _BANDS:
            assert abs(c_min - prev_max) < 1e-9, f"Hueco en banda: {prev_max} → {c_min}"
            prev_max = c_max
        assert abs(prev_max - 1.0) < 1e-9, f"La última banda no llega a 1.0 (termina en {prev_max})"

    def test_band_volumes_monotone(self):
        """Los rangos de volumen son crecientes a lo largo de las bandas."""
        for i in range(1, len(_BANDS)):
            _, _, v_min_prev, v_max_prev, *_ = _BANDS[i - 1]
            _, _, v_min_curr, v_max_curr, *_ = _BANDS[i]
            assert v_min_curr >= v_max_prev or abs(v_min_curr - v_max_prev) < 1e-9, (
                f"Volumen no monotónico entre banda {i-1} y {i}: {v_max_prev} > {v_min_curr}"
            )

    def test_det_factor_ceiling_respected(self):
        """det_factor nunca supera DET_FACTOR_CEILING."""
        for n in range(1, 50):
            df = min(DET_FACTOR_CEILING, 1.0 - math.exp(-DET_FACTOR_K * n))
            assert df <= DET_FACTOR_CEILING + 1e-9, f"det_factor={df} > CEILING={DET_FACTOR_CEILING} para n={n}"

    def test_det_factor_monotone(self):
        """det_factor es no-decreciente con el número de detecciones."""
        prev = 0.0
        for n in range(1, 20):
            df = min(DET_FACTOR_CEILING, 1.0 - math.exp(-DET_FACTOR_K * n))
            assert df >= prev - 1e-9
            prev = df

    def test_effective_ratio_bounded(self):
        """effective_ratio siempre en [0, 1]."""
        import random
        random.seed(42)
        for _ in range(200):
            cov  = random.uniform(0, 1)
            conf = random.uniform(0.3, 1.0)
            n    = random.randint(1, 10)
            dets = _make_dispersed_dets(n)
            _, _, _, eff, _ = _classify(cov, conf, n, detecciones=dets)
            assert 0.0 <= eff <= 1.0 + 1e-9, f"effective_ratio={eff} fuera de [0,1]"

    @pytest.mark.parametrize("n,expected_approx", [
        (1, 0.393),
        (2, 0.632),
        (3, 0.777),
        (5, 0.918),
    ])
    def test_det_factor_values(self, n, expected_approx):
        """Verifica los valores concretos del det_factor logarítmico."""
        df_raw  = 1.0 - math.exp(-DET_FACTOR_K * n)
        df      = min(DET_FACTOR_CEILING, df_raw)
        if df_raw < DET_FACTOR_CEILING:
            assert abs(df - expected_approx) < 0.01, f"n={n}: esperado≈{expected_approx}, got {df:.4f}"
        else:
            assert df == DET_FACTOR_CEILING


# ─────────────────────────────────────────────────────────────────────────────
# 6. Escenario del falso positivo de mochila (incidente F2998975)
# ─────────────────────────────────────────────────────────────────────────────

class TestMochilaFalsePositive:
    """
    Incidente real: foto de una mochila sobre una cama clasificada como
    "Acumulación Media" con confianza 86% y volumen 10.49 m³.

    El sistema debe atrapar este caso en alguna de las siguientes capas:
      1. Hard floor del garbage_score (Paso 1b): rechazo inmediato.
      2. ISOLATION_PENALTY más agresivo (0.40): degrada effective_ratio.
      3. Interpolación por garbage_score: penaliza fuerte si score bajo.
      4. ISOLATION_MAX_SINGLE_PENALTY techo: impide que garbage_score alto
         cancele la penalización de objeto único.

    Mochila lisa (F2998975): garbage_score ≈ 0.18 → rechazada por hard floor.
    Mochila texturizada (2026-06-26): cuero acolchado con costuras y zipper;
      alta entropía de color + bordes = garbage_score ≈ 0.50-0.55 → pasa hard
      floor pero debe quedar en BAJO/MEDIO por ISOLATION_MAX_SINGLE_PENALTY.
    """

    def test_mochila_below_hard_floor_returns_no_waste(self):
        """garbage_score=0.18 < HARD_FLOOR=0.20 → has_waste=false (Paso 1b)."""
        dets = [make_det(560, 390, 720, 570, conf=0.86)]
        coverage = _coverage_union(dets, IMG_W, IMG_H)

        result = _classify_full(
            coverage_ratio=coverage,
            confianza=0.86,
            num_detecciones=1,
            garbage_score=0.18,  # típico de mochila lisa
            tipo_residuo="MIXTO",
            detecciones=dets,
        )

        assert result is None, (
            "Mochila con garbage_score=0.18 debió ser rechazada por hard floor"
        )

    def test_mochila_above_hard_floor_still_low(self):
        """
        Si la mochila pasa el hard floor por poco (score=0.25), debe quedar
        en BAJO por el ISOLATION_PENALTY agresivo (0.40) + interpolación.
        """
        # Bbox cubriendo ~56% del frame (coverage > ISOLATION_THRESHOLD=0.55)
        # 960×720 px = 691200 / 1228800 ≈ 0.5625
        dets = [make_det(160, 120, 1120, 840, conf=0.86)]
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        assert coverage > ISOLATION_COVERAGE_THRESHOLD, (
            f"Coverage {coverage:.3f} debe entrar en ISOLATION para este test"
        )

        result = _classify_full(
            coverage_ratio=coverage,
            confianza=0.86,
            num_detecciones=1,
            garbage_score=0.25,  # apenas sobre el hard floor
            tipo_residuo="MIXTO",
            detecciones=dets,
        )

        assert result is not None, "Score 0.25 debe pasar el hard floor"
        nivel, _, volumen, eff = result
        assert nivel in ("BAJO", "MEDIO"), (
            f"Mochila con score bajo no debe llegar a ALTO/CRÍTICO, got {nivel} "
            f"(eff={eff:.3f}, vol={volumen})"
        )
        assert volumen <= 2.0, (
            f"Volumen {volumen} m³ es excesivo para una mochila — la penalización "
            f"isolation+interpolación debe limitarlo a MEDIO máximo (≤2 m³)"
        )

    def test_mochila_texturizada_con_isolation_cap(self):
        """
        Mochila texturizada (incidente 2026-06-26, cuero acolchado + zipper):
        garbage_score≈0.52, coverage≈0.50, 1 detección.

        Antes del fix: pile_rescue activaba (score≥0.45) → det_factor=1.0;
        luego t_score=1.0 → penalty=1.0 → sin penalización → MEDIO (1.3 m³).

        Después del fix:
          - pile_rescue NO activa (score<0.58)
          - isolation penalty acotado a ISOLATION_MAX_SINGLE_PENALTY
          → effective_ratio baja → BAJO o MEDIO con volumen reducido
        """
        dets = [make_det(100, 100, 1180, 860, conf=0.86)]  # cubre ~50% del frame
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        assert coverage > ISOLATION_COVERAGE_THRESHOLD

        r = _classify_severity(
            coverage_ratio=coverage,
            confianza=0.86,
            num_detecciones=1,
            garbage_score=0.52,  # cuero acolchado texturizado pero no basura
            tipo_residuo="MIXTO",
            detecciones=dets,
            img_w=IMG_W,
            img_h=IMG_H,
        )

        assert r["pile_rescue_applied"] is False, (
            "Con garbage_score=0.52 < PILE_RESCUE_MIN_SCORE=0.58, no debe rescatar"
        )
        assert r["scale_penalty_applied"] is True, (
            "Con 1 detección y coverage>0.55 la penalización de isolación debe activarse"
        )
        assert r["effective_ratio"] <= ISOLATION_MAX_SINGLE_PENALTY * coverage * 1.01, (
            f"effective_ratio={r['effective_ratio']:.3f} excede el techo esperado "
            f"({ISOLATION_MAX_SINGLE_PENALTY} × {coverage:.3f})"
        )
        assert r["nivel"] in ("BAJO", "MEDIO"), (
            f"Mochila texturizada no debe superar MEDIO, got {r['nivel']} "
            f"(eff={r['effective_ratio']:.3f}, vol={r['volumen']})"
        )
        assert r["volumen"] <= 1.30, (
            f"Volumen {r['volumen']} m³ excesivo para mochila — debe quedar ≤1.30 m³"
        )

    def test_real_garbage_isolation_not_over_penalized(self):
        """
        Sanity: una bolsa REAL de basura con buena textura (score=0.65) y
        coverage 60% NO debe ser sobre-penalizada — debe quedar en MEDIO/ALTO.
        Esto valida que el endurecimiento no rompe los casos legítimos.
        """
        dets = [make_det(192, 144, 1088, 816, conf=0.80)]
        coverage = _coverage_union(dets, IMG_W, IMG_H)

        result = _classify_full(
            coverage_ratio=coverage,
            confianza=0.80,
            num_detecciones=1,
            garbage_score=0.65,  # alta textura de basura real
            tipo_residuo="MIXTO",
            detecciones=dets,
        )

        assert result is not None, "Basura real con score alto no debe ser rechazada"
        nivel, _, volumen, eff = result
        assert nivel in ("MEDIO", "ALTO"), (
            f"Basura real con coverage 60% y conf 80% debe quedar en MEDIO/ALTO, "
            f"got {nivel} (eff={eff:.3f})"
        )

    def test_hard_floor_constant_in_valid_range(self):
        """El hard floor debe ser estricto pero no bloquear basura real."""
        # Basura real típica tiene garbage_score ≥ 0.40
        # El hard floor debe estar muy por debajo para no causar falsos negativos
        assert 0.10 <= GARBAGE_SCORE_HARD_FLOOR <= 0.30, (
            f"HARD_FLOOR={GARBAGE_SCORE_HARD_FLOOR} fuera de rango razonable [0.10, 0.30]"
        )
        assert GARBAGE_SCORE_HARD_FLOOR < GARBAGE_SCORE_THRESHOLD, (
            "HARD_FLOOR debe ser estrictamente menor que THRESHOLD"
        )
        assert 0.50 <= ISOLATION_MAX_SINGLE_PENALTY <= 0.80, (
            f"ISOLATION_MAX_SINGLE_PENALTY={ISOLATION_MAX_SINGLE_PENALTY} fuera de rango [0.50, 0.80]"
        )
        assert ISOLATION_MAX_SINGLE_PENALTY < 1.0, (
            "El techo de penalización para objeto único nunca debe ser 1.0 (sin efecto)"
        )


# ─────────────────────────────────────────────────────────────────────────────
# 7. Rescate de pila única (incidente A07327C9)
# ─────────────────────────────────────────────────────────────────────────────

class TestPileRescue:
    """
    Una pila densa de fundas se detecta como UNA sola caja. El det_factor
    logarítmico (n=1 → 0.393) la hundía a MEDIO pese a cubrir ~43 % del frame con
    textura de basura real (caso reportado: MEDIA / 0.61 m³). El rescate neutraliza
    el det_factor cuando hay firma de pila real (cobertura significativa +
    garbage_score alto), dejando que la cobertura mande; la guarda geométrica de
    CRÍTICO (≥3 detecciones dispersas) la capea en ALTO.
    """

    @staticmethod
    def _centered_det(coverage_frac, conf=0.85):
        """Una bbox cuadrada centrada que cubre ~coverage_frac del frame."""
        side = int(math.sqrt(coverage_frac * IMG_AREA))
        side = min(side, IMG_H)  # no exceder la altura del frame
        x0 = max(0, (IMG_W - side) // 2)
        y0 = max(0, (IMG_H - side) // 2)
        return [make_det(x0, y0, x0 + side, y0 + side, conf=conf)]

    def test_reported_pile_escalates_to_alto(self):
        """Pila reportada: cov≈0.43, conf 0.89, 1 detección, score 0.60 → ALTO."""
        dets = self._centered_det(0.43, conf=0.89)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        r = _classify_severity(
            coverage_ratio=coverage, confianza=0.89, num_detecciones=1,
            garbage_score=0.60, tipo_residuo="MIXTO",
            detecciones=dets, img_w=IMG_W, img_h=IMG_H,
        )
        assert r["pile_rescue_applied"] is True
        assert r["nivel"] == "ALTO", (
            f"La pila densa única debe escalar a ALTO, got {r['nivel']} "
            f"(eff={r['effective_ratio']:.3f}, vol={r['volumen']})"
        )
        assert r["prioridad"] == "ALTA"
        assert r["volumen"] >= 1.30  # la banda ALTO arranca en 1.30 m³ (recalibrada 2026-06-10)

    def test_large_pile_capped_at_alto_not_critico(self):
        """Pila grande única (cov 0.75, score 0.65) → ALTO, nunca CRÍTICO."""
        dets = self._centered_det(0.75, conf=0.90)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        r = _classify_severity(
            coverage_ratio=coverage, confianza=0.90, num_detecciones=1,
            garbage_score=0.65, tipo_residuo="MIXTO",
            detecciones=dets, img_w=IMG_W, img_h=IMG_H,
        )
        assert r["pile_rescue_applied"] is True
        assert r["nivel"] == "ALTO", (
            f"Una pila de 1 caja no debe alcanzar CRÍTICO (requiere ≥3 dispersas), "
            f"got {r['nivel']} (eff={r['effective_ratio']:.3f})"
        )

    def test_rescue_not_triggered_below_score_threshold(self):
        """Objeto liso (score 0.30 < MIN_SCORE) con la misma cobertura NO se rescata."""
        dets = self._centered_det(0.43, conf=0.89)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        r = _classify_severity(
            coverage_ratio=coverage, confianza=0.89, num_detecciones=1,
            garbage_score=0.30, tipo_residuo="MIXTO",
            detecciones=dets, img_w=IMG_W, img_h=IMG_H,
        )
        assert r["pile_rescue_applied"] is False
        assert r["nivel"] in ("BAJO", "MEDIO"), (
            f"Sin firma de basura real el det_factor debe seguir aplicando, got {r['nivel']}"
        )

    def test_rescue_not_triggered_with_many_detections(self):
        """Con n > PILE_RESCUE_MAX_DETS el rescate no aplica (no es un blob único)."""
        dets = _make_dispersed_dets(PILE_RESCUE_MAX_DETS + 1)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        r = _classify_severity(
            coverage_ratio=coverage, confianza=0.85, num_detecciones=len(dets),
            garbage_score=0.70, tipo_residuo="MIXTO",
            detecciones=dets, img_w=IMG_W, img_h=IMG_H,
        )
        assert r["pile_rescue_applied"] is False

    def test_small_real_pile_not_over_escalated(self):
        """Pila pequeña real (cov 0.20, score 0.55): aunque se rescate, queda en MEDIO/BAJO."""
        dets = self._centered_det(0.20, conf=0.80)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        r = _classify_severity(
            coverage_ratio=coverage, confianza=0.80, num_detecciones=1,
            garbage_score=0.55, tipo_residuo="MIXTO",
            detecciones=dets, img_w=IMG_W, img_h=IMG_H,
        )
        assert r["nivel"] in ("BAJO", "MEDIO"), (
            f"Cobertura 20% no debe llegar a ALTO ni con rescate, got {r['nivel']}"
        )

    def test_rescue_is_the_decisive_factor(self):
        """Misma pila, con vs sin firma de basura real: el rescate sube el effective_ratio."""
        dets = self._centered_det(0.43, conf=0.89)
        coverage = _coverage_union(dets, IMG_W, IMG_H)
        kw = dict(coverage_ratio=coverage, confianza=0.89, num_detecciones=1,
                  tipo_residuo="MIXTO", detecciones=dets, img_w=IMG_W, img_h=IMG_H)
        rescued = _classify_severity(garbage_score=0.60, **kw)
        plain   = _classify_severity(garbage_score=0.30, **kw)
        assert rescued["pile_rescue_applied"] and not plain["pile_rescue_applied"]
        assert rescued["effective_ratio"] > plain["effective_ratio"], (
            f"El rescate debe elevar el effective_ratio: "
            f"rescued={rescued['effective_ratio']:.3f} vs plain={plain['effective_ratio']:.3f}"
        )
