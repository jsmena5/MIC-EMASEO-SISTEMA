"""Clona el repo TACO y descarga las imagenes desde sus URLs."""
import subprocess
import sys
from pathlib import Path

TACO_DIR = Path(__file__).parent.parent / "datasets_raw" / "taco"
TACO_DIR.mkdir(parents=True, exist_ok=True)

# Clonar repo si no existe
if not (TACO_DIR / "download.py").exists():
    print("[INFO] Clonando repositorio TACO...")
    subprocess.run(
        ["git", "clone", "https://github.com/pedropro/TACO.git", str(TACO_DIR)],
        check=True,
    )
    print("[OK] Repo clonado")
else:
    print("[INFO] Repo TACO ya existe, saltando clone")

# Instalar dependencias de TACO
print("[INFO] Instalando dependencias de TACO...")
subprocess.run(
    [sys.executable, "-m", "pip", "install",
     "-r", str(TACO_DIR / "requirements.txt"), "-q"],
    check=True,
)

# Descargar imagenes (puede tardar 20-60 min)
print("[INFO] Descargando imagenes TACO (puede tardar ~30 min)...")
subprocess.run(
    [sys.executable, str(TACO_DIR / "download.py")],
    cwd=str(TACO_DIR),
    check=True,
)

print("[OK] TACO descargado completamente")
