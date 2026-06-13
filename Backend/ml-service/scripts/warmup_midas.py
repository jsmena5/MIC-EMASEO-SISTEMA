"""Pre-descarga MiDaS en build-time para eliminar latencia de cold-start."""
import os
import sys

try:
    import torch
    torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True, verbose=False)
    torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True, verbose=False)
    cache = os.environ.get("TORCH_HOME", "~/.cache/torch")
    print(f"[build] MiDaS pre-descargado en {cache}", flush=True)
except Exception as e:
    print(f"[build] MiDaS offline ({e}) — se descargará en el primer uso", file=sys.stderr, flush=True)
