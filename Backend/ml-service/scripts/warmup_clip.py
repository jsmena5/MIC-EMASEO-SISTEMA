"""Pre-descarga modelos CLIP en build-time para eliminar latencia de cold-start.

Descarga RN50/openai (default de producción, rápido en CPU) y ViT-B-32/laion
(alternativa de mayor calidad). Ambos quedan en hf_cache para que el worker
arranque sin hacer requests de red independientemente de CLIP_MODEL_NAME.
"""
import os
import sys

hf_home = os.environ.get("HF_HOME", "/app/hf_cache")

_MODELS = [
    ("RN50",     "openai"),           # default prod — ~15x más rápido que ViT en CPU
    ("ViT-B-32", "laion2b_s34b_b79k"),  # alternativa mayor calidad
]

try:
    import open_clip
    for model_name, pretrained in _MODELS:
        try:
            open_clip.create_model_and_transforms(
                model_name,
                pretrained=pretrained,
                cache_dir=hf_home,
            )
            print(f"[build] CLIP {model_name}/{pretrained} pre-descargado en {hf_home}", flush=True)
        except Exception as e:
            print(f"[build] CLIP {model_name}/{pretrained} offline ({e})", file=sys.stderr, flush=True)
except Exception as e:
    print(f"[build] open_clip no disponible ({e})", file=sys.stderr, flush=True)
