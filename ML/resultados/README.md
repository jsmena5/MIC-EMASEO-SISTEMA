# Resultados — Comparación de Modelos ML

Dataset: [Garbage Collector v8](https://universe.roboflow.com/garbage-epywh/garbage-collector-qcgu1)  
Clases: 1 (garbage)  
Imágenes: 1693 (943 originales + augmentation)  
Split: 80% train / 10% val / 10% test

## Condiciones de entrenamiento

| Parámetro | Valor |
|-----------|-------|
| Epochs | 100 |
| Image size | 640×640 |
| Optimizer | AdamW |
| Augmentation | Mosaic, Flip H, Brillo±30%, Jitter color |
| Pesos iniciales | COCO pretrained |

## Tabla comparativa (eval en TEST set — RTX 3050)

| Modelo | mAP@50 | mAP@50:95 | Precision | Recall | Inferencia (ms) | Params (M) | Tamaño |
|--------|--------|-----------|-----------|--------|-----------------|------------|--------|
| YOLOv8n | 0.4175 | 0.2102 | **0.6622** | 0.3529 | **11.3** | 3.2 | 6 MB |
| YOLO11m | 0.4383 | 0.2226 | 0.4353 | **0.4941** | 36.0 | 20.1 | 39 MB |
| **RT-DETR-L** | **0.4752** | **0.2450** | 0.5523 | 0.4353 | 51.8 | 32.8 | 64 MB |
| EfficientDet-D2 | 0.0631* | 0.0178* | — | — | ~140ms/epoch | 8.1 | 26 MB |

> **Nota**: Métricas obtenidas evaluando los pesos `best.pt` en el conjunto de TEST (43 imágenes).  
> RT-DETR-L fue entrenado en CPU (Colab sin GPU disponible), por lo que sus métricas podrían mejorar con re-entrenamiento en GPU.

> *\* EfficientDet-D2: entrenamiento detenido en epoch 39/100. mAP50=0.0631 indica convergencia deficiente con este dataset. Tiempo por epoch ~140s en RTX 3050 (proyección: ~3.9h para 100 epochs). Descartado del sistema.*

## Modelo seleccionado

**RT-DETR-L** — Mayor mAP@50 (0.4752) y mAP@50:95 (0.2450) en test set.  
Mejor balance entre precision (0.5523) y recall (0.4353).  
Candidato principal para el microservicio de inferencia.

## Archivos

```
resultados/
├── metricas_test.csv        ← Tabla comparativa con todas las métricas
├── yolov8n_results.csv      ← Curvas de entrenamiento epoch x epoch
├── yolo11m_results.csv      ← Curvas de entrenamiento epoch x epoch
├── rtdetr_l_results.csv     ← Curvas de entrenamiento epoch x epoch
├── graficas/
│   ├── yolov8n_results.png
│   ├── yolo11m_results.png
│   └── rtdetr_l_results.png
└── README.md                ← Este archivo
```

> Los pesos (.pt) se almacenan en Google Drive: `emaseo_modelos/`
