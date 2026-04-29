"""
Descarga datasets públicos de Roboflow Universe y los fusiona con el dataset local.

Clases objetivo:
    0: RECICLABLE  — plástico, vidrio, cartón, latas
    1: ORGANICO    — residuos de comida, materia orgánica
    2: ESCOMBROS   — cascajo, residuos voluminosos urbanos
    3: PELIGROSO   — e-waste, baterías, electrónicos

Los datasets se fusionan con ML/dataset/ SIN borrar nada existente.
Cada archivo se renombra con un prefijo único para evitar colisiones.
Todos los IDs de clase se remapean al esquema de 5 clases del proyecto.

Uso:
    # Verificar conectividad y versiones disponibles (sin descargar)
    python descargar_nuevas_clases.py --check

    # Descarga y fusión completa
    python descargar_nuevas_clases.py

    # Solo una clase específica (por índice en DATASETS_CONFIG)
    python descargar_nuevas_clases.py --only 0 1

Configurar API key (PowerShell):
    $env:ROBOFLOW_API_KEY = "tu_clave"

Dependencias:
    pip install roboflow requests
"""

import argparse
import io
import os
import shutil
import sys
import zipfile
from pathlib import Path

import requests

# ─── API key ──────────────────────────────────────────────────────────────────
API_KEY = os.environ.get("ROBOFLOW_API_KEY", "")

# ─── Rutas ────────────────────────────────────────────────────────────────────
SCRIPT_DIR  = Path(__file__).parent
DATASET_DIR = SCRIPT_DIR / "dataset"
TMP_DIR     = SCRIPT_DIR / "_tmp_roboflow"

# ─── Datasets verificados en Roboflow Universe ────────────────────────────────
#
# workspace / project son los slugs exactos de la URL:
#   https://universe.roboflow.com/{workspace}/{project}
#
# version: None → auto-detecta la última versión disponible via REST API.
#          int  → fuerza una versión específica.

DATASETS_CONFIG: list[dict] = [
    # ── RECICLABLE (clase 0) ─────────────────────────────────────────────────
    # 8 373 imágenes. URL: universe.roboflow.com/thesis-yhtpe/recyclable-waste-detection/dataset/1
    {
        "workspace":    "thesis-yhtpe",
        "project":      "recyclable-waste-detection",
        "version":      1,
        "new_class_id": 0,
        "description":  "Residuos reciclables — botellas, plastico, vidrio, latas, carton",
    },
    # ── ORGANICO (clase 1) ───────────────────────────────────────────────────
    # 7 622 imágenes con 32 clases de residuos alimentarios.
    # URL: universe.roboflow.com/abrars-models/food-waste-detection-yolo-v8
    {
        "workspace":    "abrars-models",
        "project":      "food-waste-detection-yolo-v8",
        "version":      1,
        "new_class_id": 1,
        "description":  "Residuos organicos — food waste, restos alimentarios",
    },
    # ── ESCOMBROS (clase 2) ──────────────────────────────────────────────────
    # 2 176 imágenes de residuos urbanos voluminosos.
    # URL: universe.roboflow.com/fyp-bfx3h/yolov8-trash-detections/dataset/4
    {
        "workspace":    "fyp-bfx3h",
        "project":      "yolov8-trash-detections",
        "version":      4,
        "new_class_id": 2,
        "description":  "Escombros y residuos voluminosos urbanos",
    },
    # ── PELIGROSO (clase 3) ──────────────────────────────────────────────────
    # E-waste y electronicos desechados — proxy para residuos peligrosos.
    # URL: universe.roboflow.com/electronic-waste-detection/e-waste-dataset-r0ojc
    {
        "workspace":    "electronic-waste-detection",
        "project":      "e-waste-dataset-r0ojc",
        "version":      1,
        "new_class_id": 3,
        "description":  "Residuos peligrosos — e-waste, electronicos, baterias",
    },
]

SPLITS = ["train", "valid", "test"]

# ─── Helpers: Roboflow REST API ───────────────────────────────────────────────


def get_download_link(workspace: str, project: str, version: int, api_key: str) -> str | None:
    """
    Obtiene el link de descarga directa del zip via REST API de Roboflow.
    Retorna la URL del zip o None si falla.
    """
    url = f"https://api.roboflow.com/{workspace}/{project}/{version}/yolov8"
    try:
        r = requests.get(url, params={"api_key": api_key}, timeout=30)
        r.raise_for_status()
        link = r.json().get("export", {}).get("link", "")
        return link or None
    except Exception as exc:
        print(f"  [WARN] No se pudo obtener link de {workspace}/{project} v{version}: {exc}")
        return None


def download_and_extract(link: str, dest: Path) -> bool:
    """
    Descarga el zip desde link y lo extrae en dest.
    Muestra progreso por MB. Retorna True si OK.
    """
    try:
        print(f"  Descargando zip...", end="", flush=True)
        resp = requests.get(link, stream=True, timeout=300,
                            headers={"User-Agent": "Mozilla/5.0"})
        resp.raise_for_status()

        total = int(resp.headers.get("Content-Length", 0))
        data  = io.BytesIO()
        recv  = 0
        for chunk in resp.iter_content(chunk_size=1 << 20):  # 1 MB
            data.write(chunk)
            recv += len(chunk)
            mb = recv / (1 << 20)
            total_mb = total / (1 << 20) if total else "?"
            print(f"\r  Descargando zip... {mb:.1f}/{total_mb} MB    ", end="", flush=True)

        print(f"\r  Descarga completa: {recv/(1<<20):.1f} MB          ")
        data.seek(0)

        with zipfile.ZipFile(data) as zf:
            zf.extractall(dest)
        return True
    except Exception as exc:
        print(f"\n  [ERROR] Descarga/extracción fallida: {exc}")
        return False


def resolve_version_sdk(rf, workspace: str, project_slug: str, configured: int | None) -> int | None:
    """Mantiene compatibilidad con --check: verifica acceso via SDK."""
    if isinstance(configured, int):
        return configured
    try:
        project = rf.workspace(workspace).project(project_slug)
        n = getattr(project, "num_versions", None) or getattr(project, "versions", None)
        if isinstance(n, int) and n > 0:
            return n
        project.version(1)
        return 1
    except Exception as exc:
        print(f"  [WARN] SDK: no se pudo acceder a {workspace}/{project_slug}: {exc}")
        return None


# ─── Helpers: fusión de datasets ──────────────────────────────────────────────


def remap_label_file(src: Path, dst: Path, new_class_id: int) -> int:
    """
    Copia etiquetas de src a dst remapeando TODOS los IDs de clase a new_class_id.
    Retorna el número de anotaciones procesadas.
    """
    lines = src.read_text(encoding="utf-8").splitlines()
    new_lines: list[str] = []
    count = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split()
        if len(parts) >= 5:
            parts[0] = str(new_class_id)
            new_lines.append(" ".join(parts))
            count += 1

    dst.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(new_lines) + "\n" if new_lines else ""
    dst.write_text(content, encoding="utf-8")
    return count


def find_split_dir(root: Path, split: str) -> tuple[Path | None, Path | None]:
    """
    Localiza images/ y labels/ de un split, aceptando variantes de nombre
    (valid/validation, test/testing).
    """
    aliases = {
        "valid": ["valid", "validation"],
        "test":  ["test", "testing"],
        "train": ["train"],
    }
    for name in aliases.get(split, [split]):
        img_dir = root / name / "images"
        if img_dir.exists():
            return img_dir, root / name / "labels"
    return None, None


def merge_into_dataset(
    src_root: Path,
    dst_root: Path,
    new_class_id: int,
    file_prefix: str,
) -> dict[str, int]:
    """
    Mueve imágenes y etiquetas de src_root a dst_root con renombre por prefijo.
    """
    stats: dict[str, int] = {"images": 0, "labels": 0, "skipped": 0, "no_label": 0}

    for split in SPLITS:
        src_img_dir, src_lbl_dir = find_split_dir(src_root, split)
        if src_img_dir is None:
            continue

        dst_img_dir = dst_root / split / "images"
        dst_lbl_dir = dst_root / split / "labels"
        dst_img_dir.mkdir(parents=True, exist_ok=True)
        dst_lbl_dir.mkdir(parents=True, exist_ok=True)

        for img_path in sorted(src_img_dir.iterdir()):
            if not img_path.is_file():
                continue

            new_stem = f"{file_prefix}_{img_path.stem}"
            dst_img  = dst_img_dir / (new_stem + img_path.suffix)
            dst_lbl  = dst_lbl_dir / (new_stem + ".txt")

            if dst_img.exists():
                stats["skipped"] += 1
                continue

            shutil.copy2(img_path, dst_img)
            stats["images"] += 1

            src_lbl = (src_lbl_dir / (img_path.stem + ".txt")) if src_lbl_dir else None
            if src_lbl and src_lbl.exists():
                remap_label_file(src_lbl, dst_lbl, new_class_id)
                stats["labels"] += 1
            else:
                dst_lbl.touch()
                stats["no_label"] += 1

    return stats


# ─── Modos ────────────────────────────────────────────────────────────────────


def run_check(api_key: str) -> None:
    """Verifica acceso a cada dataset vía SDK sin descargar nada."""
    try:
        from roboflow import Roboflow
    except ImportError:
        raise SystemExit("[ERROR] pip install roboflow")

    print("=" * 65)
    print("  MODO CHECK - verificando datasets (sin descargar)")
    print("=" * 65)

    rf = Roboflow(api_key=api_key)

    for i, cfg in enumerate(DATASETS_CONFIG):
        ws   = cfg["workspace"]
        proj = cfg["project"]
        cls  = cfg["new_class_id"]
        desc = cfg["description"]
        ver_cfg = cfg.get("version")
        print(f"\n[{i}] Clase {cls}: {desc}")
        print(f"    {ws}/{proj}")

        ver = resolve_version_sdk(rf, ws, proj, ver_cfg)
        if ver:
            print(f"    OK  Version disponible: v{ver}")
        else:
            print(f"    FAIL  No accesible (privado, inexistente o error de red)")

    print("\n[DONE] Check completado. Ejecuta sin --check para descargar.")


def run_download(api_key: str, only_indices: list[int] | None) -> int:
    """Descarga y fusiona los datasets usando REST API + requests (sin SDK)."""
    TMP_DIR.mkdir(exist_ok=True)
    errors: list[str] = []

    configs = (
        [DATASETS_CONFIG[i] for i in only_indices]
        if only_indices is not None
        else DATASETS_CONFIG
    )

    print(f"[INFO] Dataset destino    : {DATASET_DIR}")
    print(f"[INFO] Tmp                : {TMP_DIR}")
    print(f"[INFO] Datasets a procesar: {len(configs)}\n")

    for cfg in configs:
        ws     = cfg["workspace"]
        proj   = cfg["project"]
        ver    = cfg["version"]
        cls    = cfg["new_class_id"]
        desc   = cfg["description"]
        prefix = f"rf{cls}_{ws[:10]}"

        print(f"--- clase {cls} ---")
        print(f"[INFO] {desc}")
        print(f"       Fuente : {ws}/{proj}  v{ver}")

        # 1. Obtener link de descarga via REST
        link = get_download_link(ws, proj, ver, api_key)
        if not link:
            msg = f"{ws}/{proj} v{ver}: no se pudo obtener link."
            print(f"[ERROR] {msg}")
            errors.append(msg)
            continue

        # 2. Descargar y extraer el zip
        tmp_path = TMP_DIR / f"cls{cls}_{ws[:12]}"
        tmp_path.mkdir(exist_ok=True)

        ok = download_and_extract(link, tmp_path)
        if not ok:
            msg = f"{ws}/{proj} v{ver}: descarga fallida."
            errors.append(msg)
            continue

        all_files = [x for x in tmp_path.rglob("*") if x.is_file()]
        print(f"  Archivos extraidos: {len(all_files)}")

        # Buscar el nivel con subcarpetas train/valid/test
        src_root = tmp_path
        for candidate in [tmp_path] + [d for d in tmp_path.iterdir() if d.is_dir()]:
            if any((candidate / s / "images").exists() for s in ["train", "valid", "test"]):
                src_root = candidate
                break

        # 3. Fusionar
        stats = merge_into_dataset(src_root, DATASET_DIR, cls, prefix)
        print(f"[OK]  Imagenes copiadas    : {stats['images']}")
        print(f"      Etiquetas remapeadas  : {stats['labels']}")
        print(f"      Sin etiqueta (bg)     : {stats['no_label']}")
        print(f"      Omitidos (ya existian): {stats['skipped']}")

    # Limpiar tmp
    try:
        shutil.rmtree(TMP_DIR)
        print("\n[INFO] Directorio temporal eliminado.")
    except Exception:
        pass

    print(f"\n{'═' * 65}")
    if errors:
        print(f"[WARN] {len(errors)} dataset(s) fallaron:")
        for e in errors:
            print(f"  • {e}")
        print("\n  Alternativas en: https://universe.roboflow.com/browse/waste")
    else:
        print("[DONE] Todos los datasets descargados y fusionados.")
    print(f"{'═' * 65}")
    return 1 if errors else 0


# ─── Entry point ──────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Descarga datasets de Roboflow y los fusiona con el dataset local."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Solo verifica conectividad y versiones disponibles (no descarga).",
    )
    parser.add_argument(
        "--only",
        nargs="+",
        type=int,
        metavar="IDX",
        help="Procesa solo los índices indicados de DATASETS_CONFIG (ej. --only 0 2).",
    )
    args = parser.parse_args()

    api_key = API_KEY or os.environ.get("ROBOFLOW_API_KEY", "")
    if not api_key:
        print(
            "[ERROR] Configura tu API key:\n"
            "        PowerShell: $env:ROBOFLOW_API_KEY = 'tu_clave'\n"
            "        CMD:        set ROBOFLOW_API_KEY=tu_clave\n"
            "        Obtén la clave en: https://app.roboflow.com → Account → Roboflow API"
        )
        return 1

    if args.check:
        run_check(api_key)
        return 0

    return run_download(api_key, args.only)


if __name__ == "__main__":
    sys.exit(main())
