"""Pre-descarga CLIP ViT-B/32 en build-time para eliminar latencia de cold-start."""
import os
import sys

try:
    import open_clip
    open_clip.create_model_and_transforms(
        "ViT-B-32",
        pretrained="laion2b_s34b_b79k",
        cache_dir=os.environ.get("HF_HOME", "/app/hf_cache"),
    )
    hf_home = os.environ.get("HF_HOME", "/app/hf_cache")
    print(f"[build] CLIP ViT-B-32 pre-descargado en {hf_home}", flush=True)
except Exception as e:
    print(f"[build] CLIP offline ({e}) — se descargará en el primer uso", file=sys.stderr, flush=True)
