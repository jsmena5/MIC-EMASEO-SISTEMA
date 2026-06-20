"""
Entrenamiento RT-DETR-L para detección de residuos — EMASEO EP
Dataset : data_v2.yaml  (~25,000 imágenes)
Hardware: RTX 3050 6 GB VRAM  |  32 GB RAM

CAMBIOS v3 (estabilidad — NaN en pérdidas):
  · amp=False  → desactiva Mixed Precision; las series 30XX producen NaN en
                 Transformers con FP16 debido al rango limitado del exponente.
  · lr0=0.00005 → LR de arranque más conservador para evitar explosión de gradientes.
  · Nuevo nombre rtdetr_l_garbage_v3 → no sobreescribe logs corruptos de v2.

Antes de entrenar, ejecuta el sanity-check del dataset:
    python ML/validate_labels.py

Activar entorno virtual:
    .\\venv_emaseo\\Scripts\\Activate.ps1   (PowerShell)
    source venv_emaseo/bin/activate         (bash/zsh)

Lanzar:
    python ML/train_rtdetr.py
"""

import logging
import os
import sys
import time
from pathlib import Path

# ── Parámetros de entrenamiento ────────────────────────────────────────────────
DATA_YAML = "dataset/data_v2.yaml"
EPOCHS    = 50       # Ciclos completos sobre el dataset
IMGSZ     = 640      # Resolución de entrada RT-DETR-L
BATCH     = 2        # RTX 3050 6 GB: batch=2 es el techo para evitar CUDA OOM
NBS       = 16       # Accumula 8 pasos (8×2=16 imgs) antes de actualizar pesos
AMP       = False    # DESACTIVADO: FP16 causa NaN en Transformers en RTX 30XX — usar FP32
WORKERS   = 4        # Hilos de carga de datos; 32 GB RAM permite alimentar la GPU sin cuello
CACHE     = False    # ¡NUNCA activar! 25 k imágenes ≈ 30 GB en RAM → colapso del sistema
PATIENCE  = 15       # Early stopping: aborta si mAP50 no mejora en 15 épocas consecutivas
NAME      = "rtdetr_l_garbage_v3"  # Nombre nuevo: no sobreescribe logs corruptos de v2
PROJECT   = "runs/train"
# ──────────────────────────────────────────────────────────────────────────────


def _configurar_logging() -> logging.Logger:
    """Duplica la salida a consola y a logs/train_rtdetr.log."""
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "train_rtdetr.log"

    fmt = logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setFormatter(fmt)

    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(fmt)

    logger = logging.getLogger("emaseo.train")
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    return logger


def verificar_gpu(log: logging.Logger) -> None:
    import torch

    if not torch.cuda.is_available():
        log.error("No se detectó GPU con soporte CUDA.")
        log.error("Instala PyTorch+CUDA: https://pytorch.org/get-started/locally/")
        sys.exit(1)

    gpu  = torch.cuda.get_device_name(0)
    prop = torch.cuda.get_device_properties(0)
    vram = prop.total_memory / 1e9

    log.info(f"GPU      : {gpu}")
    log.info(f"VRAM     : {vram:.2f} GB  (disponible al inicio)")
    log.info(f"CUDA CC  : {prop.major}.{prop.minor}")

    if vram < 7.0:
        log.info("Perfil   : RTX 3050 6 GB — batch=2 + AMP + nbs=16 activos")
        log.info("Tiempo   : ~40-80 min/época dependiendo de la velocidad del disco")
    else:
        log.warning(f"VRAM detectada ({vram:.1f} GB) mayor de lo esperado — verifica que sea la tarjeta correcta.")


def verificar_dataset(log: logging.Logger) -> None:
    data_path = Path(DATA_YAML)
    if not data_path.exists():
        log.error(f"No se encontró: {DATA_YAML}")
        log.error("Completa la Fase 1 (preparación del dataset) antes de entrenar.")
        sys.exit(1)
    log.info(f"Dataset  : {DATA_YAML}  ✓")


def _banner(log: logging.Logger) -> None:
    sep = "=" * 64
    log.info(sep)
    log.info("  RT-DETR-L  |  EMASEO EP  |  Detección de Residuos v3 (FP32)")
    log.info(sep)
    log.info(f"  epochs={EPOCHS}  batch={BATCH}  nbs={NBS}  amp={AMP}  [FP32]")
    log.info(f"  lr0=0.00005  workers={WORKERS}  cache={CACHE}  patience={PATIENCE}")
    log.info(f"  hsv_s=0.7  copy_paste=0.3  imgsz={IMGSZ}")
    log.info(sep)


def entrenar(log: logging.Logger):
    from ultralytics import RTDETR

    _banner(log)
    log.info("Cargando pesos preentrenados rtdetr-l.pt ...")

    model = RTDETR("rtdetr-l.pt")

    log.info("Iniciando entrenamiento ...")
    t0 = time.time()

    results = model.train(
        # ── Dataset ───────────────────────────────────────────────────────────
        data=DATA_YAML,
        # ── Ciclos y tamaño de lote ────────────────────────────────────────────
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,           # Obligatorio 2 para RTX 3050 6 GB
        nbs=NBS,               # Acumulación: simula batch efectivo de 16 sin costo de VRAM
        # ── Precisión mixta y caché ────────────────────────────────────────────
        amp=AMP,               # False: FP32 completo — sin riesgo de NaN en RTX 30XX
        cache=CACHE,           # False: 25 k imgs pesarían ~30 GB en RAM
        # ── Carga de datos ────────────────────────────────────────────────────
        workers=WORKERS,       # 4 hilos: aprovecha los 32 GB de RAM del sistema
        # ── Optimizador ───────────────────────────────────────────────────────
        optimizer="AdamW",
        lr0=0.00005,           # Reducido a la mitad: evita saltos bruscos al inicio (NaN)
        lrf=0.01,
        cos_lr=True,
        weight_decay=0.0005,
        warmup_epochs=5,
        # ── Early stopping ────────────────────────────────────────────────────
        patience=PATIENCE,     # Detiene si mAP50 no mejora en 15 épocas
        # ── Augmentation ──────────────────────────────────────────────────────
        mosaic=1.0,
        close_mosaic=10,       # Desactiva mosaic en las últimas 10 épocas
        copy_paste=0.3,        # Pega instancias de basura sobre fondos de calle limpia
        hsv_h=0.015,
        hsv_s=0.7,             # Alta saturación: separa basura colorida del asfalto gris
        hsv_v=0.4,
        degrees=5.0,
        translate=0.1,
        scale=0.5,
        perspective=0.0005,
        fliplr=0.5,
        erasing=0.4,
        # ── Salida ────────────────────────────────────────────────────────────
        project=PROJECT,
        name=NAME,
        exist_ok=True,
    )

    elapsed = (time.time() - t0) / 3600
    log.info(f"Entrenamiento completado en {elapsed:.2f} h")
    return results


def evaluar_en_test(log: logging.Logger) -> None:
    from ultralytics import RTDETR

    best_weights = Path(PROJECT) / NAME / "weights" / "best.pt"
    if not best_weights.exists():
        log.warning(f"No se encontró best.pt en {best_weights}  — omitiendo evaluación.")
        return

    log.info("Evaluando best.pt en split=test ...")
    model   = RTDETR(str(best_weights))
    metrics = model.val(data=DATA_YAML, split="test")

    sep = "─" * 56
    log.info(sep)
    log.info("  Métricas RT-DETR-L  (dataset v2 — split test)")
    log.info(sep)
    log.info(f"  mAP@50      = {metrics.box.map50:.4f}")
    log.info(f"  mAP@50:95   = {metrics.box.map:.4f}")
    log.info(f"  Precision   = {metrics.box.p:.4f}")
    log.info(f"  Recall      = {metrics.box.r:.4f}")
    log.info(sep)

    import glob
    test_imgs = glob.glob("dataset/test/images/*.jpg")[:20]
    if test_imgs:
        t0 = time.time()
        for img in test_imgs:
            model.predict(img, verbose=False)
        fps = len(test_imgs) / (time.time() - t0)
        log.info(f"  FPS estimado (batch=1) = {fps:.1f}")
        log.info(sep)


def _reporte_vram(log: logging.Logger) -> None:
    try:
        import torch
        if torch.cuda.is_available():
            alloc    = torch.cuda.memory_allocated(0) / 1e9
            reserved = torch.cuda.memory_reserved(0) / 1e9
            log.info(f"VRAM al terminar — asignada: {alloc:.2f} GB  |  reservada: {reserved:.2f} GB")
    except Exception:
        pass


if __name__ == "__main__":
    log = _configurar_logging()
    log.info("─── Inicio del pipeline de entrenamiento EMASEO ───")

    verificar_gpu(log)
    verificar_dataset(log)

    entrenar(log)
    evaluar_en_test(log)
    _reporte_vram(log)

    best = Path(PROJECT) / NAME / "weights" / "best.pt"
    log.info(f"Pesos finales  : {best}")
    log.info("Sube best.pt a Google Drive / emaseo_modelos / rtdetr_l_v3_best.pt")
    log.info("─── Pipeline completado ───")
