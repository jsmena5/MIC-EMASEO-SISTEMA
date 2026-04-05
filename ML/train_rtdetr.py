
"""
Entrenamiento RT-DETR-L para comparación de modelos EMASEO
Hardware objetivo: RTX 3050 6GB VRAM, 32GB RAM

Ejecutar con el entorno virtual activado:
    .\venv_emaseo\Scripts\Activate.ps1
    python train_rtdetr.py
"""

import os
from pathlib import Path
from ultralytics import RTDETR

# ── Configuración ──────────────────────────────────────────────────────────────
# Ajusta esta ruta al data.yaml descargado de Roboflow
DATA_YAML = "dataset/data.yaml"

EPOCHS     = 100
IMGSZ      = 640
BATCH      = 4      # si hay OOM, bajar a 2
AMP        = True   # mixed precision: ahorra ~40% VRAM
WORKERS    = 4
NAME       = "rtdetr_l_garbage"
PROJECT    = "runs/train"
# ──────────────────────────────────────────────────────────────────────────────


def verificar_gpu():
    import torch
    if torch.cuda.is_available():
        gpu = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        print(f"GPU detectada: {gpu} ({vram:.1f} GB VRAM)")
    else:
        print("ADVERTENCIA: No se detectó GPU. El entrenamiento usará CPU (muy lento).")
        print("Asegúrate de tener instalado PyTorch con soporte CUDA.")


def descargar_dataset():
    """Descarga el dataset desde Roboflow si no existe."""
    if Path(DATA_YAML).exists():
        print(f"Dataset ya existe en: {DATA_YAML}")
        return

    print("Descargando dataset desde Roboflow...")
    from roboflow import Roboflow

    api_key = os.environ.get("ROBOFLOW_API_KEY")
    if not api_key:
        api_key = input("Ingresa tu Roboflow API key: ").strip()

    rf = Roboflow(api_key=api_key)
    project = rf.workspace("garbage-epywh").project("garbage-collector-qcgu1")
    dataset = project.version(8).download("yolov8", location="dataset")
    print(f"Dataset descargado en: dataset/")


def entrenar():
    print(f"\n{'='*60}")
    print("Entrenando RT-DETR-L")
    print(f"  Epochs:  {EPOCHS}")
    print(f"  Batch:   {BATCH}")
    print(f"  AMP:     {AMP}")
    print(f"  ImgSz:   {IMGSZ}")
    print(f"{'='*60}\n")

    model = RTDETR("rtdetr-l.pt")
    results = model.train(
        data=DATA_YAML,
        epochs=EPOCHS,
        imgsz=IMGSZ,
        batch=BATCH,
        amp=AMP,
        workers=WORKERS,
        name=NAME,
        project=PROJECT,
        exist_ok=True,
    )
    return results


def evaluar_en_test(data_yaml: str):
    best_weights = Path(PROJECT) / NAME / "weights" / "best.pt"
    if not best_weights.exists():
        print(f"No se encontró best.pt en {best_weights}")
        return

    print("\nEvaluando en conjunto de TEST...")
    model = RTDETR(str(best_weights))
    metrics = model.val(data=data_yaml, split="test")

    print("\n── Métricas RT-DETR-L ──────────────────────────────")
    print(f"  mAP@50      = {metrics.box.map50:.4f}")
    print(f"  mAP@50:95   = {metrics.box.map:.4f}")
    print(f"  Precision   = {metrics.box.p:.4f}")
    print(f"  Recall      = {metrics.box.r:.4f}")
    print("─────────────────────────────────────────────────────")

    # Medir FPS
    import time
    import glob
    test_images = glob.glob("dataset/test/images/*.jpg")[:20]
    if test_images:
        start = time.time()
        for img in test_images:
            model.predict(img, verbose=False)
        fps = len(test_images) / (time.time() - start)
        print(f"  FPS estimado = {fps:.1f}")


if __name__ == "__main__":
    verificar_gpu()
    descargar_dataset()
    entrenar()
    evaluar_en_test(DATA_YAML)

    print("\nPesos guardados en:")
    print(f"  {PROJECT}/{NAME}/weights/best.pt")
    print("\nSube este archivo a Google Drive/emaseo_modelos/rtdetr_l_best.pt")
