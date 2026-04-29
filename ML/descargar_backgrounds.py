"""
Descarga imágenes de "background" (calles limpias, pavimento, aceras urbanas)
para usarlas como imágenes negativas en el entrenamiento del detector de residuos.

El modelo aprende de estas imágenes que NO debe disparar detecciones en zonas
sin basura (reducción de falsos positivos).

Por cada imagen descargada se crea automáticamente un .txt VACÍO en train/labels/
para que Ultralytics / RT-DETR las incluya como background samples.

Uso:
    python descargar_backgrounds.py

Dependencias:
    pip install icrawler

Backend: Bing Image Search (sin API key, sin rate-limit agresivo).
"""

import hashlib
import logging
import shutil
import tempfile
from pathlib import Path

# ─── Configuración ────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).parent
IMAGES_DIR = SCRIPT_DIR / "dataset" / "train" / "images"
LABELS_DIR = SCRIPT_DIR / "dataset" / "train" / "labels"

# (query, cantidad_a_descargar) — 6 queries × ~35 = ~210 imágenes brutas
QUERIES: list[tuple[str, int]] = [
    ("clean urban street no garbage",          35),
    ("city sidewalk pavement empty",           35),
    ("empty asphalt road urban",               35),
    ("clean concrete sidewalk city",           35),
    ("urban alley background no waste",        35),
    ("empty parking lot asphalt no people",    35),
]

TARGET_TOTAL   = 200
MIN_FILE_SIZE  = 8_000   # bytes — descarta miniaturas rotas
VALID_SUFFIXES = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".webp"})

# Silencia los logs verbosos de icrawler
logging.getLogger("icrawler").setLevel(logging.ERROR)

# ─── Helpers ──────────────────────────────────────────────────────────────────


def existing_stems(directory: Path) -> set[str]:
    """Nombres base (sin extensión) ya presentes en el directorio."""
    if not directory.exists():
        return set()
    return {p.stem for p in directory.iterdir() if p.is_file()}


def content_hash(path: Path) -> str:
    """Hash MD5 del contenido del archivo para detectar duplicados exactos."""
    return hashlib.md5(path.read_bytes()).hexdigest()


def make_empty_label(image_path: Path) -> None:
    """Crea el .txt vacío correspondiente en labels/ (background sample)."""
    (LABELS_DIR / (image_path.stem + ".txt")).touch(exist_ok=True)


def crawl_query(query: str, max_num: int, tmp_dir: Path) -> list[Path]:
    """
    Usa BingImageCrawler para descargar hasta max_num imágenes de una query.
    Las descarga en tmp_dir y retorna las rutas de los archivos descargados.
    """
    from icrawler.builtin import BingImageCrawler

    tmp_dir.mkdir(parents=True, exist_ok=True)

    crawler = BingImageCrawler(
        feeder_threads=1,
        parser_threads=1,
        downloader_threads=4,
        storage={"root_dir": str(tmp_dir)},
    )
    crawler.crawl(
        keyword=query,
        max_num=max_num,
        min_size=(200, 200),        # descarta miniaturas muy pequeñas
        file_idx_offset=0,
    )
    return [p for p in tmp_dir.iterdir() if p.is_file() and p.suffix.lower() in VALID_SUFFIXES]


# ─── Main ─────────────────────────────────────────────────────────────────────


def main() -> None:
    import importlib.util
    if importlib.util.find_spec("icrawler") is None:
        raise SystemExit(
            "[ERROR] Instala la dependencia:\n"
            "        pip install icrawler"
        )

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    downloaded   = 0
    seen_hashes: set[str] = set()
    existing     = existing_stems(IMAGES_DIR)

    print(f"[INFO] Imágenes ya presentes en train/images : {len(existing)}")
    print(f"[INFO] Objetivo                              : {TARGET_TOTAL} backgrounds nuevos\n")

    # Hash de imágenes ya existentes para deduplicación entre sesiones
    print("[INFO] Indexando hashes de imágenes existentes...")
    for p in IMAGES_DIR.iterdir():
        if p.is_file() and p.suffix.lower() in VALID_SUFFIXES and p.stat().st_size >= MIN_FILE_SIZE:
            seen_hashes.add(content_hash(p))
    print(f"[INFO] Hashes indexados: {len(seen_hashes)}\n")

    with tempfile.TemporaryDirectory(prefix="bg_crawl_") as tmp_root:
        tmp_root_path = Path(tmp_root)

        for idx, (query, max_num) in enumerate(QUERIES):
            if downloaded >= TARGET_TOTAL:
                break

            remaining = TARGET_TOTAL - downloaded
            fetch_n   = min(max_num, remaining + 30)  # margen por duplicados/errores
            print(f"[QUERY {idx+1}/{len(QUERIES)}] '{query}'  (solicitando {fetch_n})")

            tmp_dir = tmp_root_path / f"query_{idx}"
            try:
                raw_files = crawl_query(query, fetch_n, tmp_dir)
            except Exception as exc:
                print(f"  [ERROR] Crawl fallido: {exc}")
                continue

            print(f"  Descargados por crawler: {len(raw_files)}")
            accepted = 0

            for raw in sorted(raw_files):
                if downloaded >= TARGET_TOTAL:
                    break

                if raw.stat().st_size < MIN_FILE_SIZE:
                    raw.unlink()
                    continue

                img_hash = content_hash(raw)
                if img_hash in seen_hashes:
                    raw.unlink()
                    continue
                seen_hashes.add(img_hash)

                # Nombre final: bg_<hash_contenido><extension>
                new_name  = f"bg_{img_hash[:14]}{raw.suffix.lower()}"
                dest_path = IMAGES_DIR / new_name

                if dest_path.stem in existing:
                    raw.unlink()
                    continue

                shutil.move(str(raw), dest_path)
                make_empty_label(dest_path)
                downloaded += 1
                existing.add(dest_path.stem)
                accepted += 1
                print(f"  [OK] {new_name}  ({downloaded}/{TARGET_TOTAL})")

            print(f"  Aceptados en esta query: {accepted}\n")

    print(f"{'═' * 55}")
    print(f"  Backgrounds descargados : {downloaded}")
    print(f"  Labels vacíos creados   : {downloaded}")
    print(f"{'═' * 55}")

    if downloaded >= TARGET_TOTAL:
        print("[DONE] ¡Objetivo alcanzado!")
    else:
        print(
            f"[HINT] Se descargaron {downloaded}/{TARGET_TOTAL}. "
            "Agrega más entradas a QUERIES o aumenta los valores de max_num."
        )


if __name__ == "__main__":
    main()
