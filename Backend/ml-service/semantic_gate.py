"""
semantic_gate.py
─────────────────────────────────────────────────────────────────────────────
Verificador semántico basado en CLIP (ViT-B/32) para el pipeline de detección
de residuos de EMASEO EP.

Problema que resuelve
─────────────────────
El detector RT-DETR fue entrenado exclusivamente con clases de basura y fondos
de calles vacías. Nunca aprendió qué es una persona, un interior o una pantalla
como negativo. Por eso dispara con alta confianza sobre escenas texturizadas que
no son basura (personas de espaldas, ropa, muebles, etc.).

Este módulo corrige ese punto ciego: CLIP fue pre-entrenado con cientos de millones
de pares imagen-texto, conoce personas, interiores, animales, pantallas Y basura.
Simplemente preguntamos «¿esta imagen se parece más a basura o a otra cosa?» y
usamos ese juicio para filtrar los falsos positivos del detector.

Política de dos niveles
───────────────────────
• garbage_prob < SEMANTIC_REJECT_THRESHOLD  → claramente NO es basura
  → devuelve is_garbage=False, needs_review=False
  → caller: has_waste=False, confianza alta → backend → DESCARTADO

• SEMANTIC_REJECT ≤ garbage_prob < SEMANTIC_REVIEW_THRESHOLD → ambiguo
  → devuelve is_garbage=False, needs_review=True
  → caller: has_waste=True + requiere_revision=True → backend → EN_REVISION

• garbage_prob ≥ SEMANTIC_REVIEW_THRESHOLD → muy probable que sea basura
  → devuelve is_garbage=True, needs_review=False
  → caller: flujo normal → backend → PENDIENTE con prioridad

Robustez (fail-open suave)
──────────────────────────
Cualquier excepción (CLIP no disponible, imagen corrupta, OOM) devuelve
garbage_prob=None con is_garbage=True y needs_review=True.
El pipeline NO se rompe: el incidente va a EN_REVISION en lugar de fallar.
Esto es intencional: preferimos una revisión humana extra a perder incidencias reales.

Integración
───────────
    from semantic_gate import verify_is_garbage, warm_up_clip

    # Llamar al arranque del worker para pre-cargar (evita cold-start):
    warm_up_clip()

    # En run_inference, tras la inferencia del detector:
    gate = verify_is_garbage(img)
    if not gate["is_garbage"] and not gate["needs_review"]:
        # DESCARTADO
    elif gate["needs_review"]:
        # EN_REVISION
    # else: flujo normal → PENDIENTE

Variables de entorno
────────────────────
    SEMANTIC_REJECT_THRESHOLD   float  [0.0-1.0]  default 0.30
    SEMANTIC_REVIEW_THRESHOLD   float  [0.0-1.0]  default 0.62
    CLIP_MODEL_NAME             str               default "ViT-B-32"
    CLIP_PRETRAINED             str               default "laion2b_s34b_b79k"
    HF_HOME                     str               default "/app/hf_cache"
"""

import logging
import os

logger = logging.getLogger(__name__)

# ── Umbrales configurables vía entorno ────────────────────────────────────────
SEMANTIC_REJECT_THRESHOLD: float = float(os.environ.get("SEMANTIC_REJECT_THRESHOLD", "0.30"))
SEMANTIC_REVIEW_THRESHOLD: float = float(os.environ.get("SEMANTIC_REVIEW_THRESHOLD", "0.62"))

# Validar que reject < review para evitar configuración inconsistente
if SEMANTIC_REJECT_THRESHOLD >= SEMANTIC_REVIEW_THRESHOLD:
    logger.warning(
        "[semantic_gate] SEMANTIC_REJECT_THRESHOLD (%.2f) >= SEMANTIC_REVIEW_THRESHOLD (%.2f) "
        "— usando defaults 0.30 / 0.62",
        SEMANTIC_REJECT_THRESHOLD, SEMANTIC_REVIEW_THRESHOLD,
    )
    SEMANTIC_REJECT_THRESHOLD = 0.30
    SEMANTIC_REVIEW_THRESHOLD = 0.62

CLIP_MODEL_NAME: str  = os.environ.get("CLIP_MODEL_NAME",  "ViT-B-32")
CLIP_PRETRAINED:  str  = os.environ.get("CLIP_PRETRAINED",  "laion2b_s34b_b79k")
CLIP_CACHE_DIR:   str  = os.environ.get("HF_HOME", "/app/hf_cache")

# ── Prompts semánticos ────────────────────────────────────────────────────────
# Positivos: descripciones de escenas con basura real en espacio público.
# Negativos: escenas que el detector confunde con basura por textura caótica.
#
# Calibración:
#   · Usar frases cortas y específicas (CLIP correlaciona mejor con descripciones
#     visuales concretas que con palabras sueltas).
#   · Los prompts negativos no "bloquean" por sí solos; la decisión es por
#     probabilidad relativa: si la suma de softmax de positivos > threshold → basura.
#   · Para agregar un nuevo tipo de falso positivo basta con añadirlo aquí;
#     no requiere reentrenar ni redesplegar el modelo.

_POSITIVE_PROMPTS = [
    # ── English: street accumulation ──────────────────────────────────────────
    "a pile of garbage on the street",
    "trash and waste dumped on a sidewalk",
    "accumulated garbage bags on the road",
    "overflowing garbage container on a street",
    "debris and rubble pile blocking a road",
    "scattered litter and waste in a public space",
    "organic waste and food scraps dumped outside",
    "mixed trash pile on urban ground",
    "construction debris and rubble on pavement",
    "garbage bags left on the sidewalk curb",
    "plastic bags and trash scattered on a street corner",
    "household waste dumped near a building entrance",
    "waste bags and trash next to a wall on the street",
    # ── Spanish: basura en vía pública Ecuador / Latinoamérica ───────────────
    "basura acumulada en la calle",
    "fundas de basura tiradas en la acera",
    "desechos y desperdicios en la vía pública",
    "basura doméstica frente a una casa",
    "montón de basura en la esquina de una calle",
    "residuos sólidos acumulados en la vereda",
    "bolsas de basura amontonadas en la calle",
    "escombros y basura en la calzada",
    "desperdicios orgánicos tirados en el suelo",
    "basura mezclada junto a una pared o reja",
]

_NEGATIVE_PROMPTS = [
    "a person walking on the street",
    "people standing outdoors",
    "a group of people on a sidewalk",
    "a person photographed from behind",
    "a person carrying a backpack",
    "a person with a bag or purse",
    "an indoor room or office",
    "furniture inside a house",
    "a clean empty street with no trash",
    "a wall or fence with no garbage",
    "a car or vehicle on the road",
    "a pet or animal",
    "a garden or park with plants",
    "a selfie or portrait photo",
    "a photo of a screen or monitor",
    "a building facade with no trash",
    "clothing or fabric close-up",
    "a person in outdoor clothing",
    # ── Electrónicos e interiores ─────────────────────────────────────────────
    "a laptop computer on a desk",
    "a closed laptop on a table",
    "electronic devices on a work surface",
    "a computer keyboard and mouse",
    "office equipment on a desk",
    "a smartphone or tablet on a table",
    "objects on a wooden table indoors",
    # ── Cielo y naturaleza ────────────────────────────────────────────────────
    "a blue sky with clouds",
    "clouds in the sky",
    "trees and green vegetation",
    "grass and plants in a park",
    "a park with trees and no garbage",
    "green leaves and branches",
    "mountains or landscape scenery",
    "a river or water stream",
    "a garden with flowers and plants",
    # ── Ropa y accesorios ─────────────────────────────────────────────────────
    "clothing hanging on a hanger or rack",
    "a shirt or jacket worn by a person",
    "folded clothes on a surface",
    "a backpack or bag being worn",
    "shoes or footwear on the ground",
    # ── Comida y utensilios ───────────────────────────────────────────────────
    "food on a plate or table",
    "a meal being served",
    "a thermos or water bottle",
    "a cup or mug on a table",
    "kitchen utensils and cookware",
    "fruits and vegetables on a surface",
    "a market stall with fresh produce",
    # ── Mobiliario y objetos del hogar ────────────────────────────────────────
    "furniture in a clean room",
    "a sofa or chair indoors",
    "a bed or bedroom interior",
    "a bathroom or kitchen interior",
    "household appliances on a counter",
    "books on a shelf or table",
    "papers and notebooks on a desk",
    # ── Vía pública limpia ────────────────────────────────────────────────────
    "clean pavement or sidewalk with no garbage",
    "an empty road with no trash",
    "a clean public square or plaza",
    "a crosswalk on a clean street",
]

# ── Cache global del modelo CLIP ──────────────────────────────────────────────
# Lazy-load, seguro bajo el GIL de CPython. Misma estrategia que MiDaS en ml_utils.py.
_clip_model      = None
_clip_preprocess = None
_clip_tokenizer  = None
_text_features   = None   # embeddings de texto precomputados (no se recalculan por imagen)
_n_positive      = 0


def _load_clip():
    """Carga CLIP lazy y precomputa los embeddings de texto.

    Retorna (model, preprocess, text_features, n_positive) ya listos para inference.
    Lanza excepción si la carga falla — el caller la captura.
    """
    global _clip_model, _clip_preprocess, _clip_tokenizer, _text_features, _n_positive

    if _clip_model is not None:
        return _clip_model, _clip_preprocess, _text_features, _n_positive

    import torch
    import open_clip

    logger.info(
        "[CLIP] Cargando %s / %s en %s …",
        CLIP_MODEL_NAME, CLIP_PRETRAINED,
        os.environ.get("HF_HOME", CLIP_CACHE_DIR),
    )

    device = torch.device("cpu")  # ml-service usa CPU en producción (VPS Contabo)

    model, _, preprocess = open_clip.create_model_and_transforms(
        CLIP_MODEL_NAME,
        pretrained=CLIP_PRETRAINED,
        device=device,
        cache_dir=CLIP_CACHE_DIR,
    )
    model.eval()
    tokenizer = open_clip.get_tokenizer(CLIP_MODEL_NAME)

    all_prompts = _POSITIVE_PROMPTS + _NEGATIVE_PROMPTS
    tokens = tokenizer(all_prompts).to(device)

    with torch.no_grad():
        text_feats = model.encode_text(tokens)
        text_feats = text_feats / text_feats.norm(dim=-1, keepdim=True)

    _clip_model      = model
    _clip_preprocess = preprocess
    _clip_tokenizer  = tokenizer
    _text_features   = text_feats
    _n_positive      = len(_POSITIVE_PROMPTS)

    logger.info("[CLIP] Modelo listo. positivos=%d negativos=%d", _n_positive, len(_NEGATIVE_PROMPTS))
    return _clip_model, _clip_preprocess, _text_features, _n_positive


def warm_up_clip() -> bool:
    """Pre-carga CLIP al arrancar el worker (elimina latencia de cold-start).

    Retorna True si cargó correctamente, False si hubo error (no crítico).
    """
    try:
        _load_clip()
        return True
    except Exception as exc:
        logger.warning("[CLIP] warm_up falló — se reintentará en el primer request: %s", exc)
        return False


def verify_is_garbage(image) -> dict:
    """Verifica semánticamente si la imagen contiene basura real.

    Args:
        image: PIL.Image.Image (ya en memoria, en cualquier modo; se convierte a RGB).

    Returns:
        dict con las siguientes claves:
            garbage_prob   float | None  Probabilidad [0,1] de que sea basura.
                                         None si CLIP no estuvo disponible.
            is_garbage     bool          True si garbage_prob ≥ SEMANTIC_REVIEW_THRESHOLD.
            needs_review   bool          True si está en la zona ambigua
                                         [REJECT, REVIEW) o si hubo error (fail-open).
            top_label      str           Prompt con mayor probabilidad (para logs/auditoría).
            error          str | None    Descripción del error si hubo uno, None en éxito.

    Nunca lanza excepción. En caso de fallo retorna needs_review=True (fail-open suave):
    el incidente irá a EN_REVISION en lugar de descartar una posible basura real.
    """
    try:
        import torch

        model, preprocess, text_features, n_positive = _load_clip()

        img_rgb = image.convert("RGB")
        img_tensor = preprocess(img_rgb).unsqueeze(0)  # (1, 3, H, W)

        with torch.no_grad():
            img_feats = model.encode_image(img_tensor)
            img_feats = img_feats / img_feats.norm(dim=-1, keepdim=True)

            # Similitud coseno entre la imagen y cada prompt de texto
            logit_scale = model.logit_scale.exp()
            logits = (logit_scale * img_feats @ text_features.T).squeeze(0)  # (n_prompts,)

            # Softmax sobre TODOS los prompts (positivos + negativos) para obtener
            # una distribución de probabilidad. garbage_prob = Σ softmax(positivos).
            probs = logits.softmax(dim=-1)

        pos_probs = probs[:n_positive]
        neg_probs = probs[n_positive:]

        garbage_prob = float(pos_probs.sum().item())
        top_idx      = int(probs.argmax().item())
        all_prompts  = _POSITIVE_PROMPTS + _NEGATIVE_PROMPTS
        top_label    = all_prompts[top_idx]

        is_garbage   = garbage_prob >= SEMANTIC_REVIEW_THRESHOLD
        needs_review = (
            SEMANTIC_REJECT_THRESHOLD <= garbage_prob < SEMANTIC_REVIEW_THRESHOLD
        )

        logger.info(
            "[semantic_gate] garbage_prob=%.3f is_garbage=%s needs_review=%s top='%s' "
            "(reject=%.2f review=%.2f)",
            garbage_prob, is_garbage, needs_review, top_label,
            SEMANTIC_REJECT_THRESHOLD, SEMANTIC_REVIEW_THRESHOLD,
        )

        return {
            "garbage_prob": round(garbage_prob, 4),
            "is_garbage":   is_garbage,
            "needs_review": needs_review,
            "top_label":    top_label,
            "error":        None,
        }

    except Exception as exc:
        logger.warning(
            "[semantic_gate] Error en verify_is_garbage → fail-open (needs_review=True): %s",
            exc,
        )
        return {
            "garbage_prob": None,
            "is_garbage":   True,   # fail-open: no bloquear, dejar que el humano decida
            "needs_review": True,
            "top_label":    "unknown (error)",
            "error":        str(exc),
        }
