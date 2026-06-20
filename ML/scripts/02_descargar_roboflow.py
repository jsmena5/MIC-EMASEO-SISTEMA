"""Descarga garbage_detection y street_trash desde Roboflow en formato YOLOv8."""
import sys
from pathlib import Path

try:
    from roboflow import Roboflow
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "roboflow", "-q"], check=True)
    from roboflow import Roboflow

BASE = Path(__file__).parent.parent / "datasets_raw"
API_KEY = "1M9Y4zdPURjwpnSbGzDy"

rf = Roboflow(api_key=API_KEY)

# Dataset 1: Garbage piles
gd_dir = BASE / "garbage_detection"
if not (gd_dir / "train").exists():
    print("[INFO] Descargando garbage_detection (czeg5)...")
    rf.workspace("garbage-detection-czeg5") \
      .project("garbage_detection-wvzwv") \
      .version(9) \
      .download("yolov8", location=str(gd_dir), overwrite=True)
    print("[OK] garbage_detection descargado")

# Dataset 2: Street Trash
st_dir = BASE / "street_trash"
if not (st_dir / "train").exists():
    print("[INFO] Descargando street_trash...")
    rf.workspace("gregorioha-naver-com") \
      .project("street-trash") \
      .version(10) \
      .download("yolov8", location=str(st_dir), overwrite=True)
    print("[OK] street_trash descargado")
else:
    print("[INFO] street_trash ya existe, saltando")

print("[OK] Todos los datasets de Roboflow descargados")
