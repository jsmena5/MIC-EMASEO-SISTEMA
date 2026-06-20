# Resultados — Comparación de Modelos ML

## Dataset de entrenamiento

Fuente: [Garbage Collector v8 — Roboflow](https://universe.roboflow.com/garbage-epywh/garbage-collector-qcgu1)  
Clases: **1** (`garbage`)  
Split utilizado:

| Split | Imágenes |
|-------|----------|
| Train | 11.557 |
| Val   | 623 |
| Test  | — |
| **Total** | **12.180** |

---

## Condiciones de entrenamiento

### v1 (baseline)

| Parámetro | Valor |
|-----------|-------|
| Hardware | CPU (Google Colab) |
| Epochs | 100 |
| Batch size | 4 |
| Image size | 640×640 |
| Optimizer | auto |
| LR inicial | 0.01 |
| AMP | No |
| Augmentación | Mosaic, Flip H, Erasing 0.4 |

### v2 (producción actual)

| Parámetro | Valor |
|-----------|-------|
| Hardware | **GPU Google Colab (T4)** |
| Epochs | **100** (patience 25 — best en epoch **64**) |
| Batch size | **16** |
| Image size | 640×640 |
| Optimizer | **AdamW** |
| LR inicial | **0.0001** (fine-tuning) |
| AMP | Sí |
| Augmentación | Mosaic, Flip H/V, Degrees ±10°, Copy-Paste 0.1, Erasing 0.4, RandAugment |
| Entrenamiento | Múltiples sesiones reanudadas (resume=true) |

---

## Tabla comparativa (eval sobre conjunto de validación)

| Modelo | mAP@50 | mAP@50:95 | Precision | Recall | Inferencia (ms) | Params (M) | Tamaño |
|--------|--------|-----------|-----------|--------|-----------------|------------|--------|
| YOLOv8n | 0.4175 | 0.2102 | **0.6622** | 0.3529 | **11.3** | 3.2 | 6 MB |
| YOLO11m | 0.4383 | 0.2226 | 0.4353 | 0.4941 | 36.0 | 20.1 | 39 MB |
| RT-DETR-L v1 | 0.4752 | 0.2450 | 0.5523 | 0.4353 | 51.8 | 32.8 | 64 MB |
| EfficientDet-D2 | 0.0631* | 0.0178* | — | — | ~140ms/epoch | 8.1 | 26 MB |
| **RT-DETR-L v2** | **0.8802** | **0.6069** | **0.8840** | **0.8203** | ~52 | 32.8 | **63 MB** |

> **RT-DETR-L v2** es el modelo actualmente en producción (`ML/modelos/rtdetr_l_best.pt`).  
> Métricas obtenidas en el best checkpoint (epoch 64/100) sobre el conjunto de validación (623 imágenes).

> *\* EfficientDet-D2: entrenamiento detenido en epoch 39/100. Convergencia deficiente. Descartado.*

---

## Mejoras RT-DETR-L v1 → v2

| Métrica | v1 (CPU) | v2 (GPU) | Δ absoluto | Δ relativo |
|---------|----------|----------|-----------|-----------|
| mAP@50 | 0.4752 | **0.8802** | +0.4050 | **+85.2%** |
| mAP@50:95 | 0.2450 | **0.6069** | +0.3619 | **+147.7%** |
| Precision | 0.5523 | **0.8840** | +0.3317 | **+60.1%** |
| Recall | 0.4353 | **0.8203** | +0.3850 | **+88.5%** |

El salto de rendimiento se explica principalmente por:
1. **Entrenamiento en GPU** — permite batch más grande (16 vs 4) y AMP, lo que estabiliza el aprendizaje.
2. **Hiperparámetros ajustados** — lr=0.0001 (fine-tuning), AdamW, augmentación enriquecida.
3. **100 epochs completos** con reanudación de sesiones hasta alcanzar convergencia real.

---

## Modelo seleccionado

**RT-DETR-L v2** — Mayor desempeño en todas las métricas con amplio margen.  
mAP@50 de 0.8802 y Recall de 0.8203 garantizan alta tasa de detección real de residuos.  
Arquitectura idéntica al v1 (32.8 M parámetros, 63 MB) — sin cambio de infraestructura.

---

## Archivos

```
resultados/
├── metricas_test_real.json  ← Métricas por modelo (v1 y v2)
├── metricas_test.csv        ← Tabla comparativa baseline (v1)
├── yolov8n_results.csv      ← Curvas de entrenamiento epoch×epoch
├── yolo11m_results.csv      ← Curvas de entrenamiento epoch×epoch
├── rtdetr_l_results.csv     ← Curvas de entrenamiento epoch×epoch (v1)
├── graficas/
│   ├── yolov8n_results.png
│   ├── yolo11m_results.png
│   └── rtdetr_l_results.png
└── README.md                ← Este archivo
```

Curvas completas del v2 en:  
`C:\Users\Bryan\OneDrive\Documentos\Entrenamiento\emaseo_runs\rtdetr_l_emaseo_v2\results.csv`  
Pesos en `ML/modelos/rtdetr_l_best.pt` (v2, 63 MB) y `ML/modelos/rtdetr_l_best_v1_backup.pt` (v1, 189 MB).
